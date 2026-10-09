#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareProject, publishOutput, type PreparedProject } from "./runtime";
import { resolveProject } from "../site/tooling/lib/project-config";

export const help = `twiki <command> [options]

  dev                         Start the development server
  check                       Check types, links, targets, and diagrams
  build --target cloudflare   Build a complete Cloudflare Worker (default)
  build --target static       Export public static pages
  preview                     Preview the Cloudflare build locally
  deploy                      Upload the existing Cloudflare build
  prepare [--json]            Prepare the consumer-owned .twiki/site runtime
  exec -- <Bun arguments>     Run engine tooling with the resolved configuration
  init                        Create twiki.config.json (never overwrites)

  --project <directory>       Consumer root (default: current directory)
  --config <file>             Explicit declarative JSON configuration
  --                          Pass remaining arguments to dev/preview/exec
`;
export function argumentsFor(argv: string[]): {
  command: string;
  projectRoot?: string;
  configFile?: string;
  target: "cloudflare" | "static";
  json: boolean;
  extra: string[];
} {
  const command = argv[0] ?? "help";
  if (["--help", "-h", "help"].includes(command))
    return {
      command: "help",
      target: "cloudflare" as const,
      json: false,
      extra: [] as string[],
    };
  if (["--version", "-v"].includes(command))
    return {
      command: "version",
      target: "cloudflare" as const,
      json: false,
      extra: [] as string[],
    };
  if (
    ![
      "dev",
      "check",
      "build",
      "preview",
      "deploy",
      "prepare",
      "exec",
      "init",
    ].includes(command)
  )
    throw new Error("Unknown command; run twiki --help");
  let projectRoot: string | undefined;
  let configFile: string | undefined;
  let target: "cloudflare" | "static" = "cloudflare";
  let json = false;
  const extra: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      extra.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--json" && command === "prepare") json = true;
    else if (["--project", "--config", "--target"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error("Missing option value");
      if (arg === "--project") projectRoot = value;
      else if (arg === "--config") configFile = value;
      else {
        if (command !== "build" || !["cloudflare", "static"].includes(value))
          throw new Error("Build target must be cloudflare or static");
        target = value as "cloudflare" | "static";
      }
    } else if (command === "dev" || command === "preview") extra.push(arg);
    else throw new Error("Unsupported argument; run twiki --help");
  }
  if (extra.length && !["dev", "preview", "exec"].includes(command))
    throw new Error("This command does not accept passthrough arguments");
  if (command === "exec" && !extra.length)
    throw new Error("Use twiki exec -- <Bun arguments>");
  return { command, projectRoot, configFile, target, json, extra };
}
export function invocation(
  command: string,
  project: PreparedProject,
  extra: string[] = [],
) {
  const bin = (name: string) =>
    path.join(project.workDir, "node_modules", ".bin", name);
  if (command === "dev") return [bin("vite"), "dev", ...extra];
  if (command === "check") return [process.execPath, "run", "check"];
  if (command === "build") return [process.execPath, "tooling/build.ts"];
  if (command === "preview") {
    if (
      extra.some(
        (argument) =>
          argument === "-r" ||
          argument.startsWith("-r=") ||
          argument === "--remote" ||
          argument.startsWith("--remote=") ||
          argument === "--local=false",
      )
    )
      throw new Error("Preview supports local Workers only");
    const option = (name: string) => {
      const index = extra.findIndex(
        (argument) => argument === name || argument.startsWith(`${name}=`),
      );
      if (index < 0) return undefined;
      const value = extra[index].startsWith(`${name}=`)
        ? extra[index].slice(name.length + 1)
        : extra[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing ${name} value`);
      return value;
    };
    const port = option("--port") ?? "4173";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error("Preview port must be between 1 and 65535");
    const ip = option("--ip") ?? "127.0.0.1";
    const protocol = option("--local-protocol") ?? "http";
    if (protocol !== "http" && protocol !== "https")
      throw new Error("Preview protocol must be http or https");
    const host =
      ip === "0.0.0.0"
        ? "127.0.0.1"
        : ip === "::"
          ? "[::1]"
          : ip.includes(":") && !ip.startsWith("[")
            ? `[${ip}]`
            : ip;
    let origin: URL;
    try {
      origin = new URL(`${protocol}://${host}:${port}`);
    } catch {
      throw new Error("Invalid preview IP or hostname");
    }
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error("Invalid preview IP or hostname");
    let explicitOrigin = false,
      inVariables = false;
    for (const argument of extra) {
      if (argument === "--var") {
        inVariables = true;
        continue;
      }
      if (argument.startsWith("--var=")) {
        explicitOrigin ||= argument.startsWith("--var=ORIGIN:");
        inVariables = true;
        continue;
      }
      if (argument.startsWith("-")) inVariables = false;
      if (inVariables && argument.startsWith("ORIGIN:")) explicitOrigin = true;
    }
    return [
      process.execPath,
      "tooling/wrangler.ts",
      "dev",
      ...(option("--persist-to")
        ? []
        : ["--persist-to", "build/.wrangler/state"]),
      ...(option("--port") ? [] : ["--port", port]),
      ...(option("--ip") ? [] : ["--ip", ip]),
      ...(!explicitOrigin ? ["--var", `ORIGIN:${origin.origin}`] : []),
      ...extra,
    ];
  }
  if (command === "deploy")
    return [process.execPath, "tooling/deploy.ts", "--upload"];
  if (command === "exec") return [process.execPath, ...extra];
  throw new Error("Unsupported engine invocation");
}
async function run(binary: string, args: string[], project: PreparedProject) {
  const child = spawn(binary, args, {
    cwd: project.workDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...project.env,
      PATH: [
        path.join(project.workDir, "node_modules/.bin"),
        path.dirname(process.execPath),
        process.env.PATH,
      ]
        .filter(Boolean)
        .join(path.delimiter),
    },
  });
  const interrupt = (signal: NodeJS.Signals) => child.kill(signal);
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              new Error("Engine command failed (" + (code ?? signal) + ")"),
            ),
      );
    });
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  }
}
export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  if (options.command === "help") {
    console.log(help);
    return;
  }
  if (options.command === "version") {
    console.log(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return;
  }
  if (options.command === "init") {
    const file = path.resolve(
      options.projectRoot ?? process.cwd(),
      options.configFile ?? "twiki.config.json",
    );
    writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          contentDir: ".",
          discovery: "filesystem",
          publication: "private",
          site: { name: "My notes", title: "My notes" },
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log("Created twiki.config.json");
    return;
  }
  const project = prepareProject(options);
  if (options.command === "prepare") {
    console.log(
      options.json
        ? JSON.stringify(project)
        : "Twiki runtime ready: " +
            path.relative(process.cwd(), project.workDir),
    );
    return;
  }
  const resolved = resolveProject(project.workDir, project.projectRoot, {
    ...process.env,
    ...project.env,
  });
  if (
    options.command === "build" &&
    options.target === "static" &&
    resolved.publication !== "public"
  )
    throw new Error(
      'Static export requires publication: "public"; private content needs Cloudflare authentication',
    );
  if (options.command === "deploy" && !resolved.cloudflare)
    throw new Error("Deployment requires explicit cloudflare configuration");
  const [binary, ...args] = invocation(options.command, project, options.extra);
  if (options.command === "build" && options.target === "static")
    args.push("--static");
  await run(binary, args, project);
  if (options.command === "build") {
    publishOutput(project, options.target);
    console.log(
      "Output: " + path.relative(project.projectRoot, project.outputDir),
    );
  }
}
if (import.meta.main)
  try {
    await main();
  } catch (error) {
    console.error(
      "twiki: " + (error instanceof Error ? error.message : "command failed"),
    );
    process.exitCode = 1;
  }
