import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareProject, publishOutput } from "./runtime";
import { argumentsFor, invocation, main } from "./twiki";
const fixtures: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "twiki-cli-"));
  fixtures.push(root);
  const vault = path.join(root, "vault"),
    engine = path.join(root, "engine"),
    modules = path.join(root, "modules");
  for (const directory of [
    vault,
    path.join(engine, "src/lib"),
    path.join(engine, "tooling"),
    path.join(engine, "database"),
    path.join(engine, "static/fonts"),
    path.join(modules, ".bin"),
    path.join(modules, "vite"),
    path.join(modules, ".vite"),
  ])
    mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(vault, "README.md"),
    "vault must stay byte-preserved",
  );
  writeFileSync(
    path.join(engine, "src/lib/source.ts"),
    "export const value=1;",
  );
  writeFileSync(path.join(engine, "src/lib/site-config.json"), "{}");
  writeFileSync(path.join(engine, "src/lib/analytics-config.json"), "null");
  writeFileSync(path.join(engine, "tooling/tool.ts"), 'console.log("tool");');
  writeFileSync(path.join(engine, "static/fonts/font.woff2"), "font fixture");
  writeFileSync(path.join(engine, "package.json"), '{"name":"engine"}');
  writeFileSync(path.join(engine, "bun.lock"), "pinned engine");
  writeFileSync(
    path.join(engine, "database/schema.ts"),
    "export const schema = {}; ",
  );
  writeFileSync(path.join(modules, "vite/package.json"), '{"name":"vite"}');
  return {
    root,
    vault,
    engine,
    modules,
    options: {
      projectRoot: vault,
      engineDirectory: engine,
      installDependencies: (runtime: string) => {
        const target = path.join(runtime, "node_modules");
        mkdirSync(target, { recursive: true });
        cpSync(modules, target, {
          recursive: true,
          filter: (source) =>
            ![".vite", ".vite-temp", ".cache"].includes(path.basename(source)),
        });
      },
      environment: { CLOUDFLARE_API_TOKEN: "never serialize this secret" },
    },
  };
}
afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("stage code into a consumer-owned runtime and keep installation, vault and dependency caches isolated", () => {
  const f = fixture();
  const result = prepareProject(f.options);
  expect(result.workDir).toBe(path.join(f.vault, ".twiki/site"));
  expect(result.env.TWIKI_DEPENDENCY_DIR).toBe(
    path.join(result.workDir, "node_modules"),
  );
  expect(
    readFileSync(path.join(result.workDir, "src/lib/source.ts"), "utf8"),
  ).toBe("export const value=1;");
  expect(
    lstatSync(path.join(result.workDir, "src/lib/source.ts")).ino,
  ).not.toBe(lstatSync(path.join(f.engine, "src/lib/source.ts")).ino);
  expect(
    lstatSync(path.join(result.workDir, "node_modules")).isSymbolicLink(),
  ).toBe(false);
  expect(
    lstatSync(path.join(result.workDir, "node_modules/vite")).isSymbolicLink(),
  ).toBe(false);
  expect(existsSync(path.join(result.workDir, "node_modules/.vite"))).toBe(
    false,
  );
  mkdirSync(path.join(result.workDir, "node_modules/.vite"));
  writeFileSync(
    path.join(result.workDir, "node_modules/.vite/cache"),
    "local cache",
  );
  expect(readdirSync(path.join(f.modules, ".vite"))).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("never serialize");
  writeFileSync(path.join(result.workDir, "src/lib/source.ts"), "runtime edit");
  expect(readFileSync(path.join(f.engine, "src/lib/source.ts"), "utf8")).toBe(
    "export const value=1;",
  );
  expect(readFileSync(path.join(f.vault, "README.md"), "utf8")).toBe(
    "vault must stay byte-preserved",
  );
  expect(readdirSync(f.vault).sort()).toEqual([".twiki", "README.md"]);
});
test("source upgrades remove retired owned files while preserving generated products and consumer branding", () => {
  const f = fixture();
  writeFileSync(
    path.join(f.vault, "twiki.config.json"),
    JSON.stringify({
      version: 1,
      publication: "public",
      site: { name: "Personal vault", title: "Personal notes" },
    }),
  );
  const first = prepareProject(f.options);
  mkdirSync(path.join(first.workDir, "build/generated"), { recursive: true });
  writeFileSync(
    path.join(first.workDir, "build/generated/keep"),
    "cached product",
  );
  rmSync(path.join(f.engine, "src/lib/source.ts"));
  writeFileSync(path.join(f.engine, "src/lib/new.ts"), "new source");
  const second = prepareProject(f.options);
  expect(existsSync(path.join(second.workDir, "src/lib/source.ts"))).toBe(
    false,
  );
  expect(
    readFileSync(path.join(second.workDir, "build/generated/keep"), "utf8"),
  ).toBe("cached product");
  expect(
    JSON.parse(
      readFileSync(
        path.join(second.workDir, "src/lib/site-config.json"),
        "utf8",
      ),
    ).title,
  ).toBe("Personal notes");
  expect(
    readFileSync(path.join(f.engine, "src/lib/site-config.json"), "utf8"),
  ).toBe("{}");
});
test("the shipped frozen engine lock is independent of the consumer graph", () => {
  const f = fixture();
  writeFileSync(
    path.join(f.vault, "bun.lock"),
    "consumer resolved dependency graph",
  );
  const project = prepareProject(f.options);
  expect(readFileSync(path.join(project.workDir, "bun.lock"), "utf8")).toBe(
    "pinned engine",
  );
  expect(readFileSync(path.join(f.engine, "bun.lock"), "utf8")).toBe(
    "pinned engine",
  );
});

test("consumer Cloudflare resources and bindings are preserved while generated paths and default auth stay local", () => {
  const f = fixture();
  const resources = {
    name: "personal-notes",
    account_id: "example-account",
    vars: {
      OWNER_GITHUB_ID: "42",
      GITHUB_CLIENT_ID: "public-client",
      CUSTOM_VAR: "value",
    },
    d1_databases: [
      { binding: "DB", database_name: "notes", database_id: "fixture-id" },
    ],
    routes: [{ pattern: "notes.example.com", custom_domain: true }],
    workers_dev: false,
    main: "/untrusted/output",
    assets: { directory: "/untrusted/assets" },
  };
  writeFileSync(
    path.join(f.vault, "twiki.config.json"),
    JSON.stringify({
      version: 1,
      site: { url: "https://notes.example.com" },
      cloudflare: resources,
    }),
  );
  const project = prepareProject(f.options);
  const config = JSON.parse(
    readFileSync(path.join(project.workDir, "wrangler.jsonc"), "utf8"),
  );
  expect(config.name).toBe(resources.name);
  expect(config.d1_databases).toEqual(resources.d1_databases);
  expect(config.routes).toEqual(resources.routes);
  expect(config.vars).toMatchObject({
    ...resources.vars,
    ORIGIN: "https://notes.example.com",
    TWIKI_AUTH_MODE: "github",
    DISABLE_ANALYTICS: "true",
  });
  expect(config.main).toBe("build/.svelte-kit/worker.js");
  expect(config.assets.directory).toBe("build/.svelte-kit/cloudflare");
  expect(
    JSON.parse(
      readFileSync(
        path.join(project.workDir, "src/lib/analytics-config.json"),
        "utf8",
      ),
    ),
  ).toBeNull();
});
test("symlinked writable directories are rejected without modifying their targets", () => {
  const f = fixture();
  const outside = path.join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep"), "unchanged");
  symlinkSync(outside, path.join(f.vault, ".twiki"), "dir");
  expect(() => prepareProject(f.options)).toThrow("symlinks");
  expect(readdirSync(outside)).toEqual(["keep"]);
});
test("invalid configuration fails before staging; a partial failure releases its preparation lock", () => {
  const f = fixture();
  writeFileSync(path.join(f.vault, "twiki.config.json"), '{"version":2}');
  expect(() => prepareProject(f.options)).toThrow();
  expect(existsSync(path.join(f.vault, ".twiki"))).toBe(false);
  rmSync(path.join(f.vault, "twiki.config.json"));
  expect(() =>
    prepareProject({
      ...f.options,
      installDependencies: () => {
        throw new Error("simulated installer failure");
      },
    }),
  ).toThrow();
  expect(existsSync(path.join(f.vault, ".twiki/prepare.lock"))).toBe(false);
  expect(prepareProject(f.options).workDir).toContain(".twiki/site");
});
test("output is published only from a completed runtime and never replaces an arbitrary directory", () => {
  const f = fixture();
  const project = prepareProject(f.options);
  expect(() => publishOutput(project, "static")).toThrow();
  const published = path.join(
    project.workDir,
    "build/.svelte-kit/cloudflare/_published",
  );
  mkdirSync(published, { recursive: true });
  writeFileSync(path.join(published, "index.html"), "public html");
  publishOutput(project, "static");
  expect(readFileSync(path.join(project.outputDir, "index.html"), "utf8")).toBe(
    "public html",
  );
  rmSync(project.outputDir);
  mkdirSync(project.outputDir);
  writeFileSync(path.join(project.outputDir, "keep"), "existing");
  expect(() => publishOutput(project, "static")).toThrow("Refusing");
  expect(readFileSync(path.join(project.outputDir, "keep"), "utf8")).toBe(
    "existing",
  );
});
test("CLI validates explicit targets and keeps tool execution in the prepared runtime", () => {
  const f = fixture();
  const project = prepareProject(f.options);
  expect(argumentsFor(["build", "--target", "static"]).target).toBe("static");
  expect(() => argumentsFor(["build", "--target", "other"])).toThrow();
  expect(() => argumentsFor(["exec"])).toThrow();
  expect(
    invocation("exec", project, ["tooling/cache.ts", "restore"]).slice(1),
  ).toEqual(["tooling/cache.ts", "restore"]);
  expect(invocation("preview", project)).toContain("build/.wrangler/state");
  expect(
    invocation("preview", project, ["--port", "4300"]).filter(
      (argument) => argument === "--port",
    ),
  ).toHaveLength(1);
  expect(invocation("preview", project, ["--port=4300"])).not.toContain("4173");
  expect(invocation("deploy", project).slice(-1)).toEqual(["--upload"]);
});
test("init is explicit and never overwrites existing consumer configuration", async () => {
  const f = fixture();
  await main(["init", "--project", f.vault]);
  const before = readFileSync(path.join(f.vault, "twiki.config.json"));
  await expect(main(["init", "--project", f.vault])).rejects.toThrow();
  expect(readFileSync(path.join(f.vault, "twiki.config.json"))).toEqual(before);
});

test("the packaged ESM compiler removes optional TypeScript parameter markers", async () => {
  // Svelte's require entry bundles its printer, so exercise the ESM entry used by Vite.
  const { compile } = await import("svelte/compiler");
  const compiled = compile(
    '<script lang="ts">function example(value?: string): string { return value ?? "ok" }</script><p>{example()}</p>',
    { generate: "server" },
  ).js.code;
  expect(compiled).toContain("function example(value)");
  expect(compiled).not.toContain("value?");
});

test("preview derives a matching local origin and preserves explicit origin overrides", () => {
  const project = prepareProject(fixture().options);
  expect(invocation("preview", project)).toEqual([
    process.execPath,
    "tooling/wrangler.ts",
    "dev",
    "--persist-to",
    "build/.wrangler/state",
    "--port",
    "4173",
    "--ip",
    "127.0.0.1",
    "--var",
    "ORIGIN:http://127.0.0.1:4173",
  ]);
  expect(
    invocation("preview", project, [
      "--port=4301",
      "--ip",
      "localhost",
      "--local-protocol=https",
    ]),
  ).toContain("ORIGIN:https://localhost:4301");
  expect(
    invocation("preview", project, ["--ip", "::1", "--port", "4302"]),
  ).toContain("ORIGIN:http://[::1]:4302");
  expect(invocation("preview", project, ["--ip=0.0.0.0"])).toContain(
    "ORIGIN:http://127.0.0.1:4173",
  );
  for (const override of [
    ["--var", "OTHER:yes", "ORIGIN:https://custom.example"],
    ["--var=ORIGIN:https://custom.example"],
  ]) {
    expect(
      invocation("preview", project, override).filter((value) =>
        value.includes("ORIGIN:"),
      ),
    ).toHaveLength(1);
    expect(invocation("preview", project, override)).not.toContain(
      "ORIGIN:http://127.0.0.1:4173",
    );
  }
  for (const invalid of [
    ["--remote"],
    ["-r"],
    ["--port", "0"],
    ["--ip", "user@localhost"],
    ["--ip", "localhost/path"],
    ["--local-protocol", "ftp"],
  ])
    expect(() => invocation("preview", project, invalid)).toThrow();
});

test("browser authentication matches the final Worker mode without changing packaged defaults", () => {
  for (const [cloudflare, enabled] of [
    [{}, false],
    [
      {
        d1_databases: [
          { binding: "DB", database_name: "notes", database_id: "fixture" },
        ],
      },
      true,
    ],
    [
      {
        d1_databases: [
          { binding: "DB", database_name: "notes", database_id: "fixture" },
        ],
        vars: { TWIKI_AUTH_MODE: "none" },
      },
      false,
    ],
  ] as const) {
    const f = fixture();
    const source = path.join(f.engine, "src/lib/auth-config.json");
    writeFileSync(source, '{"enabled":true}');
    writeFileSync(
      path.join(f.vault, "twiki.config.json"),
      JSON.stringify({ version: 1, cloudflare }),
    );
    const prepared = prepareProject(f.options);
    const generated = path.join(prepared.workDir, "src/lib/auth-config.json");
    expect(JSON.parse(readFileSync(generated, "utf8"))).toEqual({ enabled });
    const first = lstatSync(generated).mtimeMs;
    prepareProject(f.options);
    expect(lstatSync(generated).mtimeMs).toBe(first);
    expect(readFileSync(source, "utf8")).toBe('{"enabled":true}');
  }
});

test("engine dependency declarations and lock match the shipped exact runtime graph", () => {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const root = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const engine = JSON.parse(
    readFileSync(path.join(packageRoot, "site/package.json"), "utf8"),
  );
  expect(engine.dependencies).toEqual(root.dependencies);
  expect(engine.devDependencies).toBeUndefined();
  expect(
    Object.values(engine.dependencies).every(
      (version) =>
        typeof version === "string" &&
        /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version),
    ),
  ).toBe(true);
  expect(readFileSync(path.join(packageRoot, "site/bun.lock"), "utf8")).toBe(
    readFileSync(path.join(packageRoot, "bun.lock"), "utf8").replace(
      '"name": "twiki"',
      '"name": "twiki-engine"',
    ),
  );
});
