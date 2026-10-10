import { Command, Option, CommanderError } from "commander";
import { readFileSync } from "node:fs";

export interface CLIArguments {
  command: string;
  projectRoot?: string;
  configFile?: string;
  target: "cloudflare" | "static";
  json: boolean;
  extra: string[];
  helpText?: string;
}
export const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

/** The same command tree powers parsing, terminal help and generated reference pages. */
export function createCLI(accept: (value: CLIArguments) => void = () => {}) {
  const program = new Command()
    .name("twiki")
    .description("Publish Obsidian notes to Cloudflare or a static site")
    .version(packageVersion)
    .enablePositionalOptions()
    .exitOverride();
  program
    .option(
      "--project <directory>",
      "Consumer root (default: current directory)",
    )
    .option("--config <file>", "Explicit JSON configuration");
  const definitions = [
    ["dev", "Start the development server"],
    ["check", "Check types, links, targets, and diagrams"],
    ["build", "Build a Cloudflare Worker or export public static pages"],
    ["preview", "Preview the Cloudflare build locally"],
    ["deploy", "Upload an existing Cloudflare build"],
    ["prepare", "Prepare the consumer-owned .twiki/site runtime"],
    ["exec", "Run Bun tooling in the prepared runtime"],
    ["init", "Create twiki.config.json without overwriting an existing file"],
  ];
  for (const [name, description] of definitions) {
    const command = program
      .command(name)
      .description(description)
      .option(
        "--project <directory>",
        "Consumer root (default: current directory)",
      )
      .option("--config <file>", "Explicit JSON configuration");
    if (name === "build")
      command.addOption(
        new Option("--target <target>", "Output target")
          .choices(["cloudflare", "static"])
          .default("cloudflare"),
      );
    if (name === "prepare")
      command.option("--json", "Print resolved runtime paths as JSON");
    if (["dev", "preview", "exec"].includes(name)) {
      command
        .allowUnknownOption()
        .allowExcessArguments()
        .addHelpText(
          "after",
          "\nPass engine arguments after --, e.g. twiki dev -- --port 5174.",
        );
    }
    command.action((_options, cmd: Command) => {
      const options = cmd.optsWithGlobals();
      if (name === "exec" && !cmd.args.length)
        throw new Error("Use twiki exec -- <Bun arguments>");
      accept({
        command: name,
        projectRoot: options.project,
        configFile: options.config,
        target: options.target ?? "cloudflare",
        json: options.json ?? false,
        extra: cmd.args,
      });
    });
  }
  return program;
}
export function argumentsFor(argv: string[]): CLIArguments {
  let result: CLIArguments | undefined;
  let output = "";
  const program = createCLI((value) => {
    result = value;
  });
  for (const command of [program, ...program.commands])
    command.configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: () => {},
    });
  try {
    program.parse(argv.length ? argv : ["--help"], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0)
      return {
        command: error.code === "commander.version" ? "version" : "help",
        target: "cloudflare",
        json: false,
        extra: [],
        helpText: output.trimEnd(),
      };
    throw error;
  }
  if (!result) throw new Error("Select a command; run twiki --help");
  return result;
}
