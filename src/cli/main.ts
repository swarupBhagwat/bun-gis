import pkg from "../../package.json";
import { createSources } from "../compose";
import type { SourceFactory } from "../compose";
import { BunGisError } from "../core/errors";
import { HELP, parseCli } from "./args";
import { runDownload, runValidate } from "./commands";
import { defaultIo } from "./io";
import type { Io } from "./io";

function formatError(error: unknown, verbose: boolean): string {
  if (error instanceof BunGisError) {
    return [`✗ ${error.message}`, ...(error.hint ? ["", ...error.hint.split("\n")] : [])].join("\n");
  }
  const detail = error instanceof Error ? (verbose ? (error.stack ?? error.message) : error.message) : String(error);
  return `✗ Unexpected error: ${detail}${verbose ? "" : "\n\nRun again with --verbose for details."}`;
}

// Returns the process exit code; sources are injectable so the CLI can be tested without a network.
export async function main(
  argv: string[],
  io: Io = defaultIo,
  makeSources: SourceFactory = createSources,
): Promise<number> {
  const verbose = argv.includes("--verbose");
  try {
    const parsed = parseCli(argv);
    switch (parsed.kind) {
      case "help":
        io.out(HELP);
        return 0;
      case "version":
        io.out(pkg.version);
        return 0;
      case "validate":
        return await runValidate(parsed.file, parsed.strict, io);
      case "download":
        return await runDownload(parsed.options, io, makeSources);
    }
  } catch (error) {
    io.err(formatError(error, verbose));
    return 1;
  }
}
