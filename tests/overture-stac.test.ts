import { describe, expect, test } from "bun:test";
import { BunGisError, RequestTimeoutError } from "../src/core/errors";
import { createGet } from "../src/providers/overture/http";
import { rangeFile } from "../src/providers/overture/range-file";
import { StacCatalog } from "../src/providers/overture/stac";
import { getDataset } from "../src/providers/overture/datasets";

const dataset = getDataset("buildings");
const BASE = "https://stac.overturemaps.org";
const boxes = [
  [-180, -90, 180, 90],
  [-180, -90, -10, 90],
  [-10, -90, 30, 90],
  [30, -90, 180, 90],
];
const itemUrl = (i: number) => `${BASE}/R1/buildings/building/0000${i}/0000${i}.json`;
const collection = {
  extent: { spatial: { bbox: boxes } },
  links: [{ rel: "root", href: "x" }, ...[0, 1, 2].map((i) => ({ rel: "item", href: itemUrl(i) }))],
};

function stac(overrides: Record<string, () => Response> = {}) {
  const urls: string[] = [];
  const routes: Record<string, () => Response> = {
    [`${BASE}/catalog.json`]: () => Response.json({ latest: "R1" }),
    [`${BASE}/R1/buildings/building/collection.json`]: () => Response.json(collection),
    ...[0, 1, 2].reduce((acc, i) => ({
      ...acc,
      [itemUrl(i)]: () => Response.json({ bbox: boxes[i + 1], assets: { aws: { href: `https://data.test/part-${i}.parquet` } } }),
    }), {}),
    ...overrides,
  };
  const fake = (async (url: string) => {
    urls.push(url);
    return routes[url]?.() ?? new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const retry = { retries: 0, baseDelayMs: 1, maxDelayMs: 1 };
  return { urls, get: createGet({ fetch: fake, retry }) };
}

describe("StacCatalog", () => {
  test("resolves the latest release and opens only the files under the bbox", async () => {
    const { urls, get } = stac();
    const parts = await new StacCatalog({ get }).findParts(dataset, [0, 0, 5, 5]);
    expect(parts).toEqual([{ url: "https://data.test/part-1.parquet", bbox: boxes[2] as never }]);
    expect(urls).toEqual([`${BASE}/catalog.json`, `${BASE}/R1/buildings/building/collection.json`, itemUrl(1)]);
  });

  test("release() reports the latest release and looks it up only once", async () => {
    const { urls, get } = stac();
    const catalog = new StacCatalog({ get });
    expect(await catalog.release()).toBe("R1");
    await catalog.findParts(dataset, [0, 0, 5, 5]);
    expect(urls.filter((u) => u.endsWith("/catalog.json"))).toHaveLength(1);
  });

  test("release() reports a pinned release without any request", async () => {
    const { urls, get } = stac();
    expect(await new StacCatalog({ release: "2020-01-01.0", get }).release()).toBe("2020-01-01.0");
    expect(urls).toEqual([]);
  });

  test("a failed release lookup is not cached", async () => {
    let fail = true;
    const { get } = stac({ [`${BASE}/catalog.json`]: () => (fail ? new Response("", { status: 404 }) : Response.json({ latest: "R1" })) });
    const catalog = new StacCatalog({ get });
    await expect(catalog.release()).rejects.toThrow();
    fail = false;
    expect(await catalog.release()).toBe("R1");
  });

  test("a bbox spanning two files opens both", async () => {
    const parts = await new StacCatalog({ get: stac().get }).findParts(dataset, [20, 0, 40, 5]);
    expect(parts.map((p) => p.url)).toEqual(["https://data.test/part-1.parquet", "https://data.test/part-2.parquet"]);
  });

  test("an explicit release skips the catalog lookup", async () => {
    const { urls, get } = stac();
    await new StacCatalog({ release: "R1", get }).findParts(dataset, [0, 0, 5, 5]);
    expect(urls).not.toContain(`${BASE}/catalog.json`);
  });

  test("a bbox outside every file yields no parts", async () => {
    const collectionNone = { ...collection, extent: { spatial: { bbox: [boxes[0], [100, 0, 101, 1], [102, 0, 103, 1], [104, 0, 105, 1]] } } };
    const { get } = stac({ [`${BASE}/R1/buildings/building/collection.json`]: () => Response.json(collectionNone) });
    expect(await new StacCatalog({ get }).findParts(dataset, [0, 0, 5, 5])).toEqual([]);
  });

  test("unknown release gives a clear error", async () => {
    const error = await new StacCatalog({ release: "nope", get: stac().get }).findParts(dataset, [0, 0, 5, 5]).catch((e) => e);
    expect(error).toBeInstanceOf(BunGisError);
    expect(error.message).toContain('release "nope"');
  });

  test("refuses an item whose bbox disagrees with the collection entry", async () => {
    const { get } = stac({ [itemUrl(1)]: () => Response.json({ bbox: [9, 9, 9, 9], assets: { aws: { href: "x" } } }) });
    await expect(new StacCatalog({ get }).findParts(dataset, [0, 0, 5, 5])).rejects.toThrow("does not match");
  });

  test("refuses a collection whose file bboxes and items differ in count", async () => {
    const broken = { ...collection, links: collection.links.slice(0, 2) };
    const { get } = stac({ [`${BASE}/R1/buildings/building/collection.json`]: () => Response.json(broken) });
    await expect(new StacCatalog({ get }).findParts(dataset, [0, 0, 5, 5])).rejects.toThrow("Unexpected STAC layout");
  });
});

describe("rangeFile", () => {
  const bytes = new Uint8Array(100).map((_, i) => i);
  function server(ignoreRange = false) {
    const ranges: string[] = [];
    const fake = (async (_url: string, init: RequestInit = {}) => {
      if (init.method === "HEAD") return new Response(null, { headers: { "content-length": "100" } });
      const range = (init.headers as Record<string, string>).Range!;
      ranges.push(range);
      if (ignoreRange) return new Response(bytes, { status: 200 });
      const [s, e] = range.replace("bytes=", "").split("-").map(Number);
      return new Response(bytes.slice(s, e! + 1), { status: 206 });
    }) as unknown as typeof fetch;
    return { ranges, get: createGet({ fetch: fake }) };
  }

  test("reports the size and reads inclusive byte ranges", async () => {
    const { ranges, get } = server();
    const file = await rangeFile("https://data.test/f.parquet", get);
    expect(file.byteLength).toBe(100);
    expect(new Uint8Array(await file.slice(10, 15))).toEqual(bytes.slice(10, 15));
    await file.slice(90);
    expect(ranges).toEqual(["bytes=10-14", "bytes=90-99"]);
  });

  test("refuses to continue when the server ignores Range (would download the whole file)", async () => {
    const file = await rangeFile("https://data.test/f.parquet", server(true).get);
    await expect(file.slice(0, 10)).rejects.toThrow("ignored the Range");
  });
});

describe("createGet timeouts", () => {
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));

  test("a request that never answers is retried, then fails with a timeout", async () => {
    let calls = 0;
    const fake = (async (_url: string, init?: RequestInit) => {
      calls++;
      return hang(init);
    }) as unknown as typeof fetch;
    const get = createGet({ fetch: fake, timeoutMs: 15, retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 1 }, sleep: async () => {} });
    const error = await get("https://data.test/x").catch((e) => e);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error.message).toContain("data.test did not answer");
    expect(calls).toBe(3);
  });

  test("a hang followed by an answer succeeds", async () => {
    let calls = 0;
    const fake = (async (_url: string, init?: RequestInit) => (calls++ === 0 ? hang(init) : new Response("ok"))) as unknown as typeof fetch;
    const get = createGet({ fetch: fake, timeoutMs: 15, sleep: async () => {} });
    expect(await (await get("https://data.test/x")).text()).toBe("ok");
  });
});

describe("createGet", () => {
  test("retries 503 and then succeeds", async () => {
    let calls = 0;
    const fake = (async () => (calls++ < 2 ? new Response("", { status: 503 }) : new Response("ok"))) as unknown as typeof fetch;
    const get = createGet({ fetch: fake, sleep: async () => {} });
    expect(await (await get("https://x.test")).text()).toBe("ok");
    expect(calls).toBe(3);
  });
});
