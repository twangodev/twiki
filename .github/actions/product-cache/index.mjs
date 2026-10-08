import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A JavaScript action receives the Actions cache service credentials. Do not
// export those credentials into a workflow log or a repository artifact.
const site = fileURLToPath(new URL("../../../site/", import.meta.url));
const mode = process.env.INPUT_MODE;
if (!["restore", "save"].includes(mode))
  throw new Error("Expected restore or save mode");
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
      ...(mode === "restore" ? ["--restore"] : []),
      ...(kind ? ["--kind", kind] : []),
      "--plan-file",
      planFile,
    ]);
    const value = JSON.parse(readFileSync(path.join(site, planFile), "utf8"));
    if (value.schema !== 1 || !Array.isArray(value.groups))
      throw new Error("Invalid product cache plan");
    return value.groups;
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
        if (hit) await run(["restore-products", "--group", group.id]);
      } catch {
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
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
    )
      throw new Error(
        "Only trusted main builds may publish production product caches",
      );
    await limited(await plan(), async (group) => {
      try {
        const transferFile = `build/generated/product-caches/save-${group.id}.json`;
        await run([
          "save-products",
          "--group",
          group.id,
          "--plan-file",
          transferFile,
        ]);
        const transfer = JSON.parse(
          readFileSync(path.join(site, transferFile), "utf8"),
        );
        if (
          transfer.schema !== 1 ||
          !Array.isArray(transfer.results) ||
          transfer.results.length !== 1 ||
          transfer.results[0].id !== group.id ||
          transfer.results[0].ready !== true
        )
          return;
        const archive = path.resolve(site, group.archive);
        if (existsSync(archive)) await saveCache([archive], group.key);
      } catch {
        console.log("Optional encrypted product save failed");
      }
    });
  }
}
