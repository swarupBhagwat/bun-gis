import type { AsyncBuffer } from "hyparquet";
import { BunGisError } from "../../core/errors";
import type { Get } from "./http";

// hyparquet reads through this; only the footer and the row groups actually needed are fetched.
export async function rangeFile(url: string, get: Get): Promise<AsyncBuffer> {
  const byteLength = Number((await get(url, { method: "HEAD" })).headers.get("content-length"));
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new BunGisError(`Cannot determine the size of ${url}`);
  }
  return {
    byteLength,
    async slice(start, end = byteLength) {
      const response = await get(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      // A 200 would mean the server ignored Range and is sending the whole ~500 MB file.
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new BunGisError(`Server ignored the Range request for ${url}`);
      }
      return response.arrayBuffer();
    },
  };
}
