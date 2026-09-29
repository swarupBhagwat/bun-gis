import type { FileSink } from "bun";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { BunGisError } from "./errors";

const encoder = new TextEncoder();

// Shared by every writer: refuse to clobber, create the folder, write beside the target and rename at the end,
// so a failed download never leaves a truncated file.
export async function writeAtomically(
  path: string,
  overwrite: boolean,
  produce: (sink: FileSink) => Promise<void>,
): Promise<void> {
  if (!overwrite && (await Bun.file(path).exists())) {
    throw new BunGisError(
      `Output already exists: ${path}`,
      "Choose another path or allow overwriting (--force).",
    );
  }
  // Bun on Windows throws EEXIST for mkdir(".", { recursive: true }), i.e. for a bare relative output like ./x.geojson.
  await mkdir(dirname(path), { recursive: true }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });

  const partial = `${path}.part`;
  const sink = Bun.file(partial).writer();
  try {
    await produce(sink);
    await sink.end();
  } catch (error) {
    await Promise.resolve(sink.end()).catch(() => {});
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, path);
}

/** UTF-8 text into a sink, counting the bytes written. */
export function textOutput(sink: FileSink) {
  let bytes = 0;
  return {
    put(text: string): void {
      const chunk = encoder.encode(text);
      bytes += chunk.byteLength;
      sink.write(chunk);
    },
    get bytes(): number {
      return bytes;
    },
  };
}
