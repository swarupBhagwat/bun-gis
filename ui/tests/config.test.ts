import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { outputDirFrom } from "../server/config";

describe("outputDirFrom", () => {
  test("uses the fallback when nothing is configured", () => {
    expect(outputDirFrom({}, "/default")).toBe("/default");
    expect(outputDirFrom({ BUNGIS_UI_OUTPUT: "" }, "/default")).toBe("/default");
    expect(outputDirFrom({ BUNGIS_UI_OUTPUT: "   " }, "/default")).toBe("/default");
  });

  test("uses BUNGIS_UI_OUTPUT, resolved to an absolute path", () => {
    expect(outputDirFrom({ BUNGIS_UI_OUTPUT: " ./scratch/out " }, "/default")).toBe(resolve("./scratch/out"));
  });
});
