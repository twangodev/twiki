import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

test("the distributed Node action matches its maintained TypeScript source", () => {
  const directory = path.join(import.meta.dirname, "github-cache");
  const config = ts.readConfigFile(
    path.join(directory, "tsconfig.json"),
    ts.sys.readFile,
  );
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    directory,
  );
  expect(parsed.errors).toEqual([]);
  const source = path.join(directory, "src/index.ts");
  const generated = ts.transpileModule(readFileSync(source, "utf8"), {
    fileName: source,
    compilerOptions: parsed.options,
  });
  expect(readFileSync(path.join(directory, "dist/index.js"), "utf8")).toBe(
    generated.outputText,
  );
});
