import { expect, test } from "bun:test";
import pkg from "../package.json";

async function cli(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out: out.trim(), err: err.trim(), exit };
}

test("--version prints the package version", async () => {
  expect(await cli("--version")).toMatchObject({ out: pkg.version, exit: 0 });
});

test("the real entry point sets the exit code on errors", async () => {
  const { err, exit } = await cli("overture", "buildings");
  expect(exit).toBe(1);
  expect(err).toContain("✗ Missing --bbox");
});
