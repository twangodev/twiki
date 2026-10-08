import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A JavaScript action receives the Actions cache service credentials. Do not
// export those credentials into a workflow log or a repository artifact.
const site = fileURLToPath(new URL("../../../site/", import.meta.url));
const mode = process.env.INPUT_MODE;
if (!["restore", "save"].includes(mode))
  throw new Error("Expected restore or save mode");
const namespace = process.env.INPUT_NAMESPACE || "production";
if (!["production", "benchmark"].includes(namespace))
  throw new Error("Unsupported product cache namespace");
if (
  namespace === "benchmark" &&
  (process.env.GITHUB_REF !== "refs/heads/perf/build-performance" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
)
  throw new Error(
    "Benchmark caches require an explicit trusted manual branch run",
  );
if (
  mode === "save" &&
  namespace === "production" &&
  (process.env.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME))
)
  throw new Error(
    "Only trusted main builds may publish production product caches",
  );
const prefix =
  namespace === "benchmark"
    ? "wisconsin-products-benchmark-v1-"
    : "wisconsin-products-v1-";
const counts = {
  requested: 0,
  hits: 0,
  misses: 0,
  restored: 0,
  rebuild_needed: 0,
  published: 0,
  skipped: 0,
  failed: 0,
};
if (!process.env.BUILD_CACHE_KEY) {
  console.log(
    "Encrypted product cache unavailable; using the normal build path",
  );
} else {
  const { restoreCache, saveCache, isFeatureAvailable } = await import(
    new URL(
      "../../../site/node_modules/@actions/cache/lib/cache.js",
      import.meta.url,
    )
  );
  if (!isFeatureAvailable())
    throw new Error("Actions cache service is unavailable");
  mkdirSync(path.join(site, "build/generated/product-caches"), {
    recursive: true,
  });
  const planFile = "build/generated/product-caches/action-plan.json";
  function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn("bun", ["tooling/cache.ts", ...args], {
        cwd: site,
        env: process.env,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Build product cache command failed")),
      );
    });
  }
  async function limited(groups, operation) {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, groups.length) }, async () => {
        while (next < groups.length) await operation(groups[next++]);
      }),
    );
  }
  async function plan(kind) {
    await run([
      "plan",
      "--namespace",
      namespace,
      ...(mode === "restore" ? ["--restore"] : []),
      ...(kind ? ["--kind", kind] : []),
      "--plan-file",
      planFile,
    ]);
    const value = JSON.parse(readFileSync(path.join(site, planFile), "utf8"));
    if (
      value.schema !== 1 ||
      value.namespace !== namespace ||
      !Array.isArray(value.groups)
    )
      throw new Error("Invalid product cache plan");
    for (const group of value.groups) {
      if (
        typeof group.id !== "string" ||
        !/^[a-z0-9-]+$/.test(group.id) ||
        group.namespace !== namespace ||
        typeof group.key !== "string" ||
        !group.key.startsWith(prefix) ||
        !Array.isArray(group.restoreKeys ?? []) ||
        !(group.restoreKeys ?? []).every(
          (key) => typeof key === "string" && key.startsWith(prefix),
        )
      )
        throw new Error("Product cache plan crosses its selected namespace");
      const expectedArchive = path.join(
        site,
        "build/generated/product-caches",
        ...(namespace === "benchmark" ? ["benchmark"] : []),
        `${group.id}.gpg`,
      );
      if (
        typeof group.archive !== "string" ||
        path.resolve(site, group.archive) !== expectedArchive
      )
        throw new Error("Product archive crosses its selected namespace");
    }
    counts.requested += value.groups.length;
    console.log(
      "Encrypted product cache plan: " +
        JSON.stringify({
          mode,
          namespace,
          kind: kind ?? "all",
          groups: value.groups.length,
        }),
    );
    return value.groups;
  }
  async function transfer(group, operation) {
    const transferFile = `build/generated/product-caches/${operation}-${namespace}-${group.id}.json`;
    rmSync(path.join(site, transferFile), { force: true });
    await run([
      `${operation}-products`,
      "--namespace",
      namespace,
      "--group",
      group.id,
      "--plan-file",
      transferFile,
    ]);
    const value = JSON.parse(
      readFileSync(path.join(site, transferFile), "utf8"),
    );
    return (
      value.schema === 1 &&
      value.namespace === namespace &&
      Array.isArray(value.results) &&
      value.results.length === 1 &&
      value.results[0] !== null &&
      value.results[0].id === group.id &&
      value.results[0].ready === true
    );
  }
  async function restore(kind) {
    await limited(await plan(kind), async (group) => {
      const archive = path.resolve(site, group.archive);
      if (
        !archive.startsWith(
          path.join(site, "build/generated/product-caches") + path.sep,
        )
      )
        throw new Error("Product archive escapes the cache directory");
      try {
        const hit = await restoreCache(
          [archive],
          group.key,
          group.restoreKeys ?? [],
        );
        if (!hit) {
          counts.misses++;
          counts.rebuild_needed++;
        } else {
          counts.hits++;
          if (await transfer(group, "restore")) counts.restored++;
          else counts.rebuild_needed++;
        }
      } catch {
        counts.failed++;
        counts.rebuild_needed++;
        console.log(
          "Optional encrypted product restore failed; consumers will validate or rebuild",
        );
      }
    });
  }
  if (mode === "restore") {
    // The compact global index supplies exact immutable course product keys.
    await restore("global");
    await restore("application");
    await restore("search");
    await restore("course");
  } else {
    await limited(await plan(), async (group) => {
      try {
        if (!(await transfer(group, "save"))) {
          counts.skipped++;
          return;
        }
        const archive = path.resolve(site, group.archive);
        if (existsSync(archive) && (await saveCache([archive], group.key)) >= 0)
          counts.published++;
        else counts.skipped++;
      } catch {
        counts.failed++;
        console.log("Optional encrypted product save failed");
      }
    });
  }
}
console.log(
  "Encrypted product cache results: " +
    JSON.stringify({ mode, namespace, ...counts }),
);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(counts)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
