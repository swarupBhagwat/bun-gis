import type { Progress } from "../core/ports";
import { formatBytes } from "../format";

export function createProgress({ quiet = false, write = console.error } = {}): Progress {
  if (quiet) return { phase() {}, done() {} };
  return {
    phase: (label) => write(`Downloading ${label}...`),
    done: ({ featureCount, bytes, elapsedMs, output }) =>
      write(
        [
          "✓ Download complete",
          `✓ Features: ${featureCount.toLocaleString("en-US")}`,
          `✓ Size: ${formatBytes(bytes)}`,
          `✓ Time: ${(elapsedMs / 1000).toFixed(2)}s`,
          `✓ Saved: ${output}`,
        ].join("\n"),
      ),
  };
}
