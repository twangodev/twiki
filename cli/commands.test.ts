import { expect, test } from "bun:test";
import { argumentsFor } from "./commands";
test("Commander owns global options, command help, choices and errors", () => {
  expect(
    argumentsFor(["--project", "vault", "build", "--target=static"]),
  ).toMatchObject({ command: "build", projectRoot: "vault", target: "static" });
  expect(
    argumentsFor(["build", "--project=vault", "--config", "custom.json"]),
  ).toMatchObject({ projectRoot: "vault", configFile: "custom.json" });
  expect(argumentsFor(["build", "--help"]).helpText).toContain("--target");
  expect(argumentsFor(["build", "--help"]).helpText).not.toContain("Commands:");
  for (const argv of [
    ["unknown"],
    ["build", "--unknown"],
    ["check", "unexpected"],
    ["build", "--target", "other"],
    ["exec"],
  ])
    expect(() => argumentsFor(argv)).toThrow();
});
test("passthrough preserves engine flags and stops interpreting Twiki options after --", () => {
  expect(
    argumentsFor(["dev", "--", "--port", "5174", "--project", "vite-project"])
      .extra,
  ).toEqual(["--port", "5174", "--project", "vite-project"]);
  expect(argumentsFor(["preview", "--port", "4174"]).extra).toEqual([
    "--port",
    "4174",
  ]);
  expect(argumentsFor(["exec", "--", "-e", "console.log(1)"]).extra).toEqual([
    "-e",
    "console.log(1)",
  ]);
});
