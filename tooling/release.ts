import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validatePackagePlan, verifyArchive } from "./package.mjs";

const root = path.resolve(import.meta.dirname, "..");

export function verifyReleaseIdentity(
  directory: string,
  tag: string,
  sha: string,
) {
  const pkg = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  assert.equal(
    tag,
    `v${pkg.version}`,
    "Release tag must match the package version",
  );
  assert.match(sha, /^[a-f0-9]{40}$/, "Release commit must be a full SHA");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  assert.equal(
    git("rev-parse", "HEAD"),
    sha,
    "Checkout must match the release commit",
  );
  assert.equal(
    git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`),
    sha,
    "Tag must point to the release commit",
  );
}

function pack() {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (
    process.env.RELEASE_TAG !== undefined ||
    process.env.RELEASE_SHA !== undefined
  ) {
    verifyReleaseIdentity(
      root,
      process.env.RELEASE_TAG ?? "",
      process.env.RELEASE_SHA ?? "",
    );
  } else
    assert(!process.env.CI, "CI releases require RELEASE_TAG and RELEASE_SHA");
  execFileSync("git", ["diff", "--exit-code"], { cwd: root, stdio: "inherit" });
  const dist = path.join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const plan = JSON.parse(
    execFileSync(
      "bun",
      [
        "x",
        "--bun",
        "npm@latest",
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        dist,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  const entry = validatePackagePlan(
    Array.isArray(plan) ? plan : Object.values(plan),
    pkg,
  );
  const archive = path.join(dist, entry.filename);
  verifyArchive(
    archive,
    entry.files.map((file: { path: string }) => file.path),
  );
  copyFileSync(archive, path.join(dist, "twiki.tgz"));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `dist-tag=${pkg.version.includes("-") ? "next" : "latest"}\n`,
    );
  }
  console.log(`Packed ${pkg.name}@${pkg.version}: ${entry.files.length} files`);
}

function smoke() {
  const directory = mkdtempSync(path.join(tmpdir(), "twiki-package-"));
  try {
    const example = execFileSync("git", ["archive", "HEAD", "examples/vault"], {
      cwd: root,
    });
    execFileSync("tar", ["-x", "-C", directory, "--strip-components=2"], {
      input: example,
    });
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "twiki-release-smoke",
        private: true,
        type: "module",
      }),
    );
    execFileSync(
      "bun",
      ["add", "--exact", "--ignore-scripts", path.join(root, "dist/twiki.tgz")],
      { cwd: directory, stdio: "inherit" },
    );
    const cli = path.join(directory, "node_modules/.bin/twiki");
    for (const args of [
      ["--version"],
      ["build", "--target", "cloudflare"],
      ["exec", "--", "run", "check:types"],
      ["build", "--target", "static"],
    ])
      execFileSync(cli, args, { cwd: directory, stdio: "inherit" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "pack") pack();
  else if (command === "smoke") smoke();
  else throw new Error("Use pack or smoke");
}
