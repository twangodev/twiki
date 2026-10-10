import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { argumentsFor, createCLI } from "../cli/commands";
import { parseProjectConfig } from "../site/tooling/lib/project-config";
const root = path.resolve(import.meta.dirname, "..");
const notes = path.join(root, "documentation/notes");
const pages = readdirSync(notes, { recursive: true })
  .filter((file) => String(file).endsWith(".md"))
  .map(String);

test("documentation examples validate against the actual configuration schema", () => {
  let examples = 0;
  for (const file of pages)
    for (const match of readFileSync(path.join(notes, file), "utf8").matchAll(
      /```json twiki-config\n([\s\S]*?)\n```/g,
    )) {
      expect(() => parseProjectConfig(JSON.parse(match[1]))).not.toThrow();
      examples++;
    }
  expect(examples).toBeGreaterThanOrEqual(2);
  expect(() =>
    parseProjectConfig(
      JSON.parse(
        readFileSync(
          path.join(root, "documentation/twiki.config.json"),
          "utf8",
        ),
      ),
    ),
  ).not.toThrow();
});
test("every documentation page is linked and every wikilink resolves outside code fences", () => {
  const slugs = new Set(pages.map((file) => file.replace(/\.md$/, "")));
  const incoming = new Set<string>(["index"]);
  for (const file of pages) {
    const text = readFileSync(path.join(notes, file), "utf8")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "");
    for (const match of text.matchAll(
      /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g,
    )) {
      expect(slugs.has(match[1])).toBe(true);
      incoming.add(match[1]);
    }
  }
  expect([...slugs].filter((slug) => !incoming.has(slug))).toEqual([]);
});
test("published CLI examples parse using Commander and init executes in an isolated vault", () => {
  for (const command of createCLI().commands)
    expect(argumentsFor([command.name(), "--help"]).helpText).toContain(
      command.name(),
    );
  for (const args of [
    ["dev", "--", "--port", "5174"],
    ["build", "--target", "static"],
    ["preview"],
    ["prepare", "--json"],
    ["exec", "--", "tooling/cache.ts", "restore"],
  ])
    expect(() => argumentsFor(args)).not.toThrow();
  const vault = mkdtempSync(path.join(tmpdir(), "twiki-docs-example-"));
  try {
    execFileSync(process.execPath, [
      path.join(root, "cli/twiki.ts"),
      "init",
      "--project",
      vault,
    ]);
    expect(
      parseProjectConfig(
        JSON.parse(readFileSync(path.join(vault, "twiki.config.json"), "utf8")),
      ).publication,
    ).toBe("private");
    expect(() =>
      execFileSync(
        process.execPath,
        [path.join(root, "cli/twiki.ts"), "init", "--project", vault],
        { stdio: "pipe" },
      ),
    ).toThrow();
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
