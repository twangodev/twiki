import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseProjectConfig,
  resolveProject,
  writeProjectSiteConfig,
  type ResolvedProject,
} from "../site/tooling/lib/project-config";

export interface PreparedProject {
  projectRoot: string;
  workDir: string;
  outputDir: string;
  env: Record<string, string>;
}
export interface PrepareOptions {
  projectRoot?: string;
  configFile?: string;
  environment?: NodeJS.ProcessEnv;
  /** Override only for package integration fixtures. */
  engineDirectory?: string;
  /** Override only for isolated installer fixtures. */
  installDependencies?: (workDir: string) => void;
}
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const engineDirectories = [
  "src",
  "tooling",
  "worker",
  "assets",
  "static",
  "migrations",
  "database",
];
const engineFiles = [
  "package.json",
  "bun.lock",
  "svelte.config.js",
  "vite.config.ts",
  "tsconfig.json",
  "wrangler.jsonc",
  "_headers",
  "_redirects",
  "drizzle.config.ts",
];
const safeRelative = (file: string) =>
  file !== "" &&
  !path.isAbsolute(file) &&
  !file.includes("\\") &&
  file.split("/").every((part) => part !== "" && part !== "." && part !== "..");
function directory(root: string, target: string) {
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error("Runtime path escapes its consumer directory");
  for (const part of relative.split(path.sep).filter(Boolean)) {
    root = path.join(root, part);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || realpathSync(root) !== root))
      throw new Error("Runtime directories must not be symlinks");
    if (!stat) mkdirSync(root);
  }
}
function writeRuntime(root: string, file: string, bytes: string | Uint8Array) {
  if (!safeRelative(file)) throw new Error("Unsafe runtime filename");
  const target = path.join(root, file);
  directory(root, path.dirname(target));
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || realpathSync(target) !== target))
    throw new Error("Runtime files must be regular");
  const value = Buffer.from(bytes);
  if (stat?.size === value.length && readFileSync(target).equals(value)) return;
  const temporary = target + ".twiki-tmp-" + process.pid;
  try {
    writeFileSync(temporary, value);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function inventory(source: string) {
  const files = engineFiles.filter((file) =>
    existsSync(path.join(source, file)),
  );
  const walk = (relative: string) => {
    const absolute = path.join(source, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      const file = relative + "/" + entry.name;
      if (
        file === "src/lib/generated" ||
        file.startsWith("static/_") ||
        file === "static/.wrangler"
      )
        continue;
      if (entry.isSymbolicLink())
        throw new Error("Packaged engine files must not be symlinks");
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  for (const folder of engineDirectories) walk(folder);
  return [...new Set(files)].sort();
}
function installEngineDependencies(
  root: string,
  environment: NodeJS.ProcessEnv,
) {
  const modules = path.join(root, "node_modules");
  directory(root, modules);
  const contained = (file: string) => {
    const relative = path.relative(modules, file);
    return (
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative)
    );
  };
  // Retire links from older CLI staging without following or mutating their targets.
  // Existing consumer-owned Vite caches and isolated package installs stay intact.
  const retireLinks = (folder: string, nested = false) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        if (!existsSync(file) || !contained(realpathSync(file))) rmSync(file);
      } else if (
        !nested &&
        entry.isDirectory() &&
        (entry.name.startsWith("@") || entry.name === ".bin")
      )
        retireLinks(file, true);
    }
  };
  retireLinks(modules);
  const installed = spawnSync(
    process.execPath,
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--backend",
      "copyfile",
      "--silent",
    ],
    {
      cwd: root,
      env: { ...process.env, ...environment },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (installed.error)
    throw new Error(
      `Unable to install the frozen Twiki engine: ${installed.error.message}`,
    );
  if (installed.status !== 0)
    throw new Error(
      `Frozen Twiki engine dependency installation failed: ${installed.stderr.trim() || "bun install exited unsuccessfully"}`,
    );
}
export function wranglerConfiguration(project: ResolvedProject) {
  const supplied = project.cloudflare ?? {};
  const rawVars = supplied.vars;
  if (
    rawVars !== undefined &&
    (!rawVars || typeof rawVars !== "object" || Array.isArray(rawVars))
  )
    throw new Error("cloudflare.vars must be an object");
  const bindings = Array.isArray(supplied.d1_databases)
    ? supplied.d1_databases
    : [];
  const vars = {
    ORIGIN: project.site.url,
    TWIKI_SITE_NAME: project.site.name,
    TWIKI_SITE_DESCRIPTION: project.site.description,
    TWIKI_AUTH_MODE: bindings.some(
      (binding) =>
        binding &&
        typeof binding === "object" &&
        (binding as { binding?: string }).binding === "DB",
    )
      ? "github"
      : "none",
    DISABLE_ANALYTICS: project.analytics ? "false" : "true",
    ...(project.analytics
      ? {
          TWIKI_ANALYTICS_SITE_ID: project.analytics.siteId,
          TWIKI_ANALYTICS_ENDPOINT: project.analytics.endpoint ?? "",
        }
      : {}),
    ...(rawVars as Record<string, string> | undefined),
  };
  return {
    name: "twiki",
    compatibility_date: "2026-06-07",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [],
    workers_dev: vars.TWIKI_AUTH_MODE === "none",
    preview_urls: false,
    routes: [],
    ...supplied,
    vars,
    main: "build/.svelte-kit/worker.js",
    assets: {
      binding: "ASSETS",
      directory: "build/.svelte-kit/cloudflare",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: true,
    },
  };
}
/** Copies maintained engine code; package installation and source vault remain read-only. */
export function prepareProject(options: PrepareOptions = {}): PreparedProject {
  const environment = options.environment ?? process.env;
  const projectRoot = realpathSync(
    path.resolve(
      options.projectRoot ?? environment.TWIKI_PROJECT_ROOT ?? process.cwd(),
    ),
  );
  const state = path.join(projectRoot, ".twiki");
  const workDir = path.join(state, "site");
  const requested = options.configFile ?? environment.TWIKI_CONFIG_FILE;
  const configFile = requested
    ? path.resolve(projectRoot, requested)
    : path.join(projectRoot, "twiki.config.json");
  const raw = existsSync(configFile)
    ? parseProjectConfig(JSON.parse(readFileSync(configFile, "utf8")))
    : { version: 1 as const };
  if (requested && !existsSync(configFile))
    throw new Error("The requested Twiki config does not exist");
  const inputEnvironment = {
    ...environment,
    TWIKI_PROJECT_ROOT: projectRoot,
    TWIKI_CONFIG_FILE: existsSync(configFile) ? configFile : undefined,
  };
  const project = resolveProject(workDir, projectRoot, inputEnvironment);
  if (
    !existsSync(project.contentDir) ||
    !lstatSync(project.contentDir).isDirectory()
  )
    throw new Error("The content directory does not exist");
  directory(projectRoot, state);
  const lock = path.join(state, "prepare.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Another Twiki command is preparing this project; retry when it finishes",
      );
    throw error;
  }
  try {
    const source = realpathSync(
      options.engineDirectory ?? path.join(packageRoot, "site"),
    );
    const files = inventory(source);
    directory(projectRoot, workDir);
    const previousFile = path.join(state, "engine.json");
    let previous: string[] = [];
    if (existsSync(previousFile)) {
      const saved = JSON.parse(readFileSync(previousFile, "utf8"));
      if (
        !Array.isArray(saved.files) ||
        !saved.files.every(
          (file: unknown) => typeof file === "string" && safeRelative(file),
        )
      )
        throw new Error("Invalid runtime source inventory");
      previous = saved.files;
    }
    for (const file of files)
      if (
        ![
          "src/lib/site-config.json",
          "src/lib/analytics-config.json",
          "src/lib/auth-config.json",
          "wrangler.jsonc",
        ].includes(file)
      )
        writeRuntime(workDir, file, readFileSync(path.join(source, file)));
    for (const file of previous)
      if (!files.includes(file)) {
        directory(workDir, path.dirname(path.join(workDir, file)));
        rmSync(path.join(workDir, file), { force: true });
      }
    (
      options.installDependencies ??
      ((runtime) => installEngineDependencies(runtime, environment))
    )(workDir);
    const modules = path.join(workDir, "node_modules");
    directory(workDir, modules);
    writeRuntime(state, "config.json", JSON.stringify(raw, null, 2) + "\n");
    writeProjectSiteConfig(workDir, project);
    writeRuntime(
      workDir,
      "src/lib/analytics-config.json",
      JSON.stringify(project.analytics ?? null, null, 2) + "\n",
    );
    const wrangler = wranglerConfiguration(project);
    writeRuntime(
      workDir,
      "src/lib/auth-config.json",
      JSON.stringify(
        { enabled: wrangler.vars.TWIKI_AUTH_MODE === "github" },
        null,
        2,
      ) + "\n",
    );
    writeRuntime(
      workDir,
      "wrangler.jsonc",
      JSON.stringify(wrangler, null, 2) + "\n",
    );
    writeRuntime(
      state,
      "engine.json",
      JSON.stringify({ schema: 1, files }, null, 2) + "\n",
    );
    return {
      projectRoot,
      workDir,
      outputDir: path.join(state, "output"),
      env: {
        TWIKI_PROJECT_ROOT: projectRoot,
        TWIKI_CONFIG_FILE: path.join(state, "config.json"),
        TWIKI_CONTENT_DIR: project.contentDir,
        TWIKI_SITE_DIR: workDir,
        TWIKI_DEPENDENCY_DIR: modules,
        TWIKI_DEPENDENCY_PATHS: JSON.stringify([modules]),
      },
    };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
/** A stable output alias avoids copying every asset after an already successful build. */
export function publishOutput(
  project: PreparedProject,
  target: "cloudflare" | "static",
) {
  const source = path.join(
    project.workDir,
    "build/.svelte-kit",
    ...(target === "static" ? ["cloudflare", "_published"] : []),
  );
  if (!existsSync(source))
    throw new Error("The build did not produce the requested output");
  const stat = lstatSync(project.outputDir, { throwIfNoEntry: false });
  if (stat && !stat.isSymbolicLink())
    throw new Error(
      "Refusing to replace an existing non-symlink output directory",
    );
  const temporary = project.outputDir + ".tmp-" + process.pid;
  try {
    symlinkSync(
      path.relative(path.dirname(project.outputDir), source),
      temporary,
      "dir",
    );
    renameSync(temporary, project.outputDir);
  } finally {
    rmSync(temporary, { force: true });
  }
}
