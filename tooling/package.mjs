import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "cli/twiki.ts",
  "cli/runtime.ts",
  "cli/commands.ts",
  "cli/twiki.schema.json",
  "integrations/github-cache/dist/index.js",
  "integrations/github-cache/src/index.ts",
  "integrations/github-cache/action.yml",
  "site/package.json",
  "site/bun.lock",
  "site/svelte.config.js",
  "site/vite.config.ts",
  "site/tsconfig.json",
  "site/wrangler.jsonc",
  "site/drizzle.config.ts",
  "site/tooling/build.ts",
  "site/tooling/deploy.ts",
  "site/tooling/lib/project-config.ts",
  "site/tooling/lib/project-schema.ts",
  "site/worker/index.ts",
  "site/src/app.html",
  "site/static/favicon.ico",
];
const files = new Set(requiredFiles);
const prefixes = [
  "cli/",
  "integrations/github-cache/",
  "site/src/",
  "site/tooling/",
  "site/worker/",
  "site/assets/",
  "site/static/fonts/",
  "site/migrations/",
  "site/database/",
];
const additionalFiles = new Set([
  "bun.lock",
  "site/_headers",
  "site/_redirects",
]);

export function validatePackagePlan(plan, expected) {
  assert(
    Array.isArray(plan) && plan.length === 1,
    "Expected exactly one package",
  );
  const entry = plan[0];
  assert.equal(expected.name, "@twango/twiki");
  assert.equal(entry.name, expected.name);
  assert.equal(entry.version, expected.version);
  assert.equal(entry.filename, `twango-twiki-${expected.version}.tgz`);
  assert(Array.isArray(entry.files), "Missing package file inventory");
  const paths = entry.files.map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length, "Duplicate package file");
  for (const name of paths) {
    assert(
      typeof name === "string" && !/[\x00-\x1f\x7f\\]/.test(name),
      "Unsafe package filename",
    );
    const segments = name.split("/");
    assert(
      !segments.some((segment) =>
        [
          "",
          ".",
          "..",
          ".git",
          ".twiki",
          "node_modules",
          "build",
          ".svelte-kit",
          "generated",
        ].includes(segment),
      ),
      "Generated or unsafe package path",
    );
    assert(
      !segments.some((segment) =>
        /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|^\.npmrc$/.test(segment),
      ),
      "Configuration secret in package",
    );
    assert(
      files.has(name) ||
        additionalFiles.has(name) ||
        prefixes.some((prefix) => name.startsWith(prefix)),
      "Unexpected package path",
    );
  }
  for (const name of requiredFiles)
    assert(paths.includes(name), `Missing runtime file: ${name}`);
  assert(
    paths.some((name) => name.startsWith("site/static/fonts/")),
    "Missing runtime fonts",
  );
  assert(
    paths.some((name) => name.startsWith("site/migrations/")),
    "Missing database migrations",
  );
  return entry;
}

export function verifyArchive(archive, paths) {
  const listing = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .trimEnd()
    .split("\n")
    .filter((name) => !name.endsWith("/"));
  assert(
    listing.every((name) => name.startsWith("package/")),
    "Archive contains an unexpected root",
  );
  assert.deepEqual(
    listing.map((name) => name.slice("package/".length)).sort(),
    [...paths].sort(),
    "Archive differs from inspected package inventory",
  );
  const types = execFileSync("tar", ["-tvzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert(
    types
      .trimEnd()
      .split("\n")
      .every((line) => line.startsWith("-")),
    "Archive contains nonregular files",
  );
}
