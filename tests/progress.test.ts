import { describe, expect, test } from "bun:test";
import { formatBytes } from "../src/format";
import { createProgress } from "../src/download/progress";

describe("formatBytes", () => {
  test.each([
    [0, "0 B"], [999, "999 B"], [1024, "1.0 KB"], [116_884, "114.1 KB"],
    [6.5 * 1024 * 1024, "6.5 MB"], [3 * 1024 ** 3, "3.0 GB"],
  ])("%d → %s", (bytes, text) => expect(formatBytes(bytes)).toBe(text));
});

describe("createProgress", () => {
  const result = { source: "overture", dataset: "buildings", output: "./b.geojson", featureCount: 18432, bytes: 26_000_000, elapsedMs: 8420 };

  test("prints phase and summary", () => {
    const lines: string[] = [];
    const progress = createProgress({ write: (t) => lines.push(t) });
    progress.phase("overture buildings");
    progress.done(result);
    expect(lines).toEqual([
      "Downloading overture buildings...",
      "✓ Download complete\n✓ Features: 18,432\n✓ Size: 24.8 MB\n✓ Time: 8.42s\n✓ Saved: ./b.geojson",
    ]);
  });

  test("quiet prints nothing", () => {
    const lines: string[] = [];
    const progress = createProgress({ quiet: true, write: (t) => lines.push(t) });
    progress.phase("x");
    progress.done(result);
    expect(lines).toEqual([]);
  });
});
