import { spawn } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  mkdirSync,
  rmSync,
  writeFileSync,
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
const transport = process.env.INPUT_TRANSPORT || "groups";
if (!["groups", "bundle"].includes(transport))
  throw new Error("Unsupported product cache transport");
if (
  transport === "bundle" &&
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
)
  throw new Error("Bundle caches require an exact Git commit");
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
function groupDiagnostic(group, ready, reason) {
  console.log(
    "Encrypted product cache group: " +
      JSON.stringify({ mode, namespace, group: group.id, ready, reason }),
  );
}
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
  const products = path.join(site, "build/generated/product-caches");
  const bundleDirectory = path.join(products, "bundles", namespace);
  let runtime;
  let bundleLoadPromise;
  let bundleAvailable = false;
  let bundleGroups = new Set();
  const selectedBundleGroups = new Set();
  const bundleGroupId =
    /^(?:application|(?:global|files-global|search)-(?:public|full)|(?:course|course-files)-(?:public|full)-[a-f0-9]{16})$/;
  function regular(file) {
    return lstatSync(file).isFile() && realpathSync(file) === file;
  }
  function cleanBundleDirectory() {
    if (realpathSync(products) !== products)
      throw new Error("Unsafe product cache root");
    const parent = path.dirname(bundleDirectory);
    mkdirSync(parent, { recursive: true });
    if (realpathSync(parent) !== parent)
      throw new Error("Unsafe bundle cache directory");
    if (
      lstatSync(bundleDirectory, { throwIfNoEntry: false }) &&
      (!lstatSync(bundleDirectory).isDirectory() ||
        realpathSync(bundleDirectory) !== bundleDirectory)
    )
      throw new Error("Unsafe bundle cache directory");
    rmSync(bundleDirectory, { recursive: true, force: true });
    mkdirSync(bundleDirectory);
  }
  function bundleKey() {
    return `${prefix}bundle-${runtime}-${process.env.GITHUB_SHA}`;
  }
  async function loadBundle() {
    if (!bundleLoadPromise) bundleLoadPromise = loadBundleOnce();
    await bundleLoadPromise;
  }
  async function loadBundleOnce() {
    try {
      cleanBundleDirectory();
      const hit = await restoreCache([bundleDirectory], bundleKey(), [
        `${prefix}bundle-${runtime}-`,
      ]);
      if (!hit) return;
      if (
        !lstatSync(bundleDirectory).isDirectory() ||
        realpathSync(bundleDirectory) !== bundleDirectory
      )
        throw new Error("Unsafe restored bundle directory");
      const manifestFile = path.join(bundleDirectory, "bundle.json");
      if (!regular(manifestFile) || lstatSync(manifestFile).size > 256 * 1024)
        throw new Error("Invalid bundle metadata");
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      if (
        manifest.schema !== 1 ||
        manifest.namespace !== namespace ||
        manifest.runtime !== runtime ||
        !Array.isArray(manifest.groups) ||
        manifest.groups.length > 4096 ||
        !manifest.groups.every(
          (id) => typeof id === "string" && bundleGroupId.test(id),
        ) ||
        new Set(manifest.groups).size !== manifest.groups.length
      )
        throw new Error("Invalid bundle metadata");
      bundleGroups = new Set(manifest.groups);
      for (const name of readdirSync(bundleDirectory)) {
        const file = path.join(bundleDirectory, name);
        if (
          !regular(file) ||
          (name !== "bundle.json" &&
            (!name.endsWith(".gpg") || !bundleGroups.has(name.slice(0, -4))))
        )
          throw new Error("Unexpected bundle entry");
      }
      bundleAvailable = true;
    } catch {
      counts.failed++;
      console.log(
        "Optional encrypted bundle restore rejected; consumers will rebuild",
      );
    }
  }
  async function archiveHit(group, archive) {
    if (transport === "groups")
      return !!(await restoreCache(
        [archive],
        group.key,
        group.restoreKeys ?? [],
      ));
    await loadBundle();
    selectedBundleGroups.add(group.id);
    const source = path.join(bundleDirectory, `${group.id}.gpg`);
    if (!bundleAvailable || !bundleGroups.has(group.id) || !existsSync(source))
      return false;
    if (!regular(source)) throw new Error("Unsafe bundle archive");
    mkdirSync(path.dirname(archive), { recursive: true });
    if (
      realpathSync(path.dirname(archive)) !== path.dirname(archive) ||
      (lstatSync(archive, { throwIfNoEntry: false }) && !regular(archive))
    )
      throw new Error("Unsafe product archive destination");
    copyFileSync(source, archive);
    return true;
  }
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
    if (transport === "bundle") {
      if (
        !/^[a-f0-9]{64}$/.test(value.runtime ?? "") ||
        (runtime && runtime !== value.runtime)
      )
        throw new Error("Invalid bundle runtime identity");
      runtime = value.runtime;
    }
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
      if (transport === "bundle" && !bundleGroupId.test(group.id))
        throw new Error("Unsupported bundle group");
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
    const valid =
      value.schema === 1 &&
      value.namespace === namespace &&
      Array.isArray(value.results) &&
      value.results.length === 1 &&
      value.results[0] !== null &&
      value.results[0].id === group.id &&
      typeof value.results[0].ready === "boolean";
    if (!valid) return { ready: false, reason: "invalid-result" };
    const result = value.results[0];
    return {
      ready: result.ready,
      reason: result.ready
        ? "ready"
        : ["missing-secret", "miss", "invalid"].includes(result.reason)
          ? result.reason
          : "not-ready",
    };
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
        const hit = await archiveHit(group, archive);
        if (!hit) {
          counts.misses++;
          counts.rebuild_needed++;
          groupDiagnostic(group, false, "archive-miss");
        } else {
          counts.hits++;
          const result = await transfer(group, "restore");
          if (result.ready) counts.restored++;
          else {
            counts.rebuild_needed++;
            groupDiagnostic(group, false, result.reason);
          }
        }
      } catch {
        counts.failed++;
        counts.rebuild_needed++;
        groupDiagnostic(group, false, "operation-error");
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
    if (
      transport === "bundle" &&
      bundleAvailable &&
      [...bundleGroups].some((id) => !selectedBundleGroups.has(id))
    ) {
      counts.failed++;
      console.log(
        "Optional encrypted bundle contained unselected groups; consumers will validate or rebuild",
      );
    }
  } else {
    const groups = await plan();
    const prepared = [];
    if (transport === "bundle") cleanBundleDirectory();
    await limited(groups, async (group) => {
      try {
        const result = await transfer(group, "save");
        if (!result.ready) {
          counts.skipped++;
          groupDiagnostic(group, false, result.reason);
          return;
        }
        const archive = path.resolve(site, group.archive);
        if (!existsSync(archive)) {
          counts.skipped++;
          groupDiagnostic(group, false, "archive-missing");
        } else if (!regular(archive)) throw new Error("Unsafe product archive");
        else if (transport === "bundle") {
          copyFileSync(archive, path.join(bundleDirectory, `${group.id}.gpg`));
          prepared.push(group);
        } else if ((await saveCache([archive], group.key)) >= 0)
          counts.published++;
        else {
          counts.skipped++;
          groupDiagnostic(group, true, "cache-not-created");
        }
      } catch {
        counts.failed++;
        groupDiagnostic(group, false, "operation-error");
        console.log("Optional encrypted product save failed");
      }
    });
    if (transport === "bundle" && prepared.length) {
      writeFileSync(
        path.join(bundleDirectory, "bundle.json"),
        JSON.stringify({
          schema: 1,
          namespace,
          runtime,
          groups: prepared.map((group) => group.id).sort(),
        }) + "\n",
        { mode: 0o600 },
      );
      try {
        if ((await saveCache([bundleDirectory], bundleKey())) >= 0)
          counts.published += prepared.length;
        else {
          counts.skipped += prepared.length;
          for (const group of prepared)
            groupDiagnostic(group, true, "cache-not-created");
        }
      } catch {
        counts.failed += prepared.length;
        for (const group of prepared)
          groupDiagnostic(group, false, "operation-error");
        console.log("Optional encrypted bundle save failed");
      }
    }
  }
}
console.log(
  "Encrypted product cache results: " +
    JSON.stringify({ mode, namespace, transport, ...counts }),
);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(counts)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
