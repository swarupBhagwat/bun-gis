import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BunGisError, HttpError } from "bun-gis";
import type { FeatureSource } from "bun-gis";
import { createApi, safeName } from "../server/api";
import { parseSSE } from "../src/sse";
import type { SseEvent } from "../src/sse";
import { fakeSource, tempPath } from "../../tests/fixtures";

const BODY = { provider: "overture", dataset: "buildings", bbox: [0, 0, 1, 1], filename: "out.geojson" };

const freshDir = async () => join((await tempPath()).replace(/[^\\/]+$/, ""), "output");

async function setup(source: FeatureSource = fakeSource(3), heartbeatMs = 10_000) {
  const dir = await freshDir();
  const api = createApi({ outputDir: dir, makeSources: () => new Map([["overture", source]]), heartbeatMs });
  return { api, dir };
}

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function events(response: Response): Promise<SseEvent[]> {
  return parseSSE(await response.text()).events;
}

const gated = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const source: FeatureSource = {
    ...fakeSource(1),
    async *download(request) {
      await gate;
      yield* fakeSource(1).download(request);
    },
  };
  return { source, release };
};

describe("safeName", () => {
  test("accepts plain names and adds the extension", () => {
    expect(safeName("munich-buildings.geojson")).toBe("munich-buildings.geojson");
    expect(safeName("  a_b.1  ")).toBe("a_b.1.geojson");
  });
  test.each(["", "..", "../x", "a/b", "a\\b", ".hidden", "sp ace", "C:\\x", "x/../y"])("rejects %j", (name) => {
    expect(() => safeName(name)).toThrow(BunGisError);
  });
  test("rejects non-strings", () => expect(() => safeName(undefined)).toThrow(BunGisError));
});

describe("parseSSE", () => {
  test("parses events, ignores comments, keeps the unfinished tail", () => {
    const { events, rest } = parseSSE(': ping\n\nevent: log\ndata: {"a":1}\n\nevent: result\ndata: {"b"');
    expect(events).toEqual([{ event: "log", data: { a: 1 } }]);
    expect(rest).toBe('event: result\ndata: {"b"');
  });
});

describe("GET /api/info", () => {
  test("lists providers, defaults and the version", async () => {
    const { api } = await setup();
    const info = await api.info().json();
    expect(info.providers.map((p: { id: string }) => p.id)).toEqual(["overture"]);
    expect(info.defaults.retries).toBe(3);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("POST /api/download", () => {
  test("streams log and result events and saves the file", async () => {
    const { api, dir } = await setup();
    const response = await api.download(post(BODY));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const list = await events(response);
    expect(list.map((e) => e.event)).toEqual(["log", "result"]);
    expect(list[0]!.data).toEqual({ level: "info", text: "Downloading overture buildings..." });
    expect(list[1]!.data).toMatchObject({ featureCount: 3, filename: "out.geojson", source: "overture" });
    const saved = JSON.parse(await Bun.file(join(dir, "out.geojson")).text());
    expect(saved.features).toHaveLength(3);
    expect(saved.attribution).toContain("Overture");
  });

  test("forwards retry/failover notices as warn logs and verbose settings as debug", async () => {
    const api = createApi({
      outputDir: await freshDir(),
      makeSources: ({ warn }) => {
        warn("a.test failed (HTTP 504); trying b.test");
        return new Map([["overture", fakeSource(1)]]);
      },
    });
    const list = await events(await api.download(post({ ...BODY, verbose: true })));
    const levels = list.filter((e) => e.event === "log").map((e) => (e.data as { level: string }).level);
    expect(levels).toEqual(["debug", "warn", "info"]);
  });

  test("passes release and retries through to the source factory", async () => {
    let seen: unknown;
    const api = createApi({
      outputDir: await freshDir(),
      makeSources: (settings) => {
        seen = settings;
        return new Map([["overture", fakeSource(1)]]);
      },
    });
    await (await api.download(post({ ...BODY, release: "R", retries: 5 }))).text();
    expect(seen).toMatchObject({ release: "R", retries: 5 });
  });

  test("validation errors arrive as an error event with the hint", async () => {
    const { api } = await setup();
    const list = await events(await api.download(post({ ...BODY, bbox: [10, 0, 5, 1] })));
    expect(list).toHaveLength(1);
    expect(list[0]!.event).toBe("error");
    const data = list[0]!.data as { message: string; hint: string };
    expect(data.message).toContain("Invalid bbox");
    expect(data.hint).toContain("Received: 10,0,5,1");
  });

  test("refuses to overwrite unless asked, and reports it", async () => {
    const { api } = await setup();
    await (await api.download(post(BODY))).text();
    const second = await events(await api.download(post(BODY)));
    expect(second.at(-1)!.event).toBe("error");
    expect((second.at(-1)!.data as { message: string }).message).toContain("already exists");
    const third = await events(await api.download(post({ ...BODY, overwrite: true })));
    expect(third.at(-1)!.event).toBe("result");
  });

  test("a provider failure carries its message; a crash includes the stack only with verbose", async () => {
    const failing: FeatureSource = {
      ...fakeSource(1),
      async *download() {
        throw new HttpError("Overture", 429, undefined, "Try another server.");
      },
    };
    const crashing: FeatureSource = {
      ...fakeSource(1),
      async *download() {
        throw new Error("boom");
      },
    };
    const http = await events(await (await setup(failing)).api.download(post(BODY)));
    expect(http.at(-1)!.data).toMatchObject({ message: "Overture request failed: HTTP 429", hint: "Try another server." });
    const quiet = await events(await (await setup(crashing)).api.download(post(BODY)));
    expect((quiet.at(-1)!.data as { stack?: string }).stack).toBeUndefined();
    const loud = await events(await (await setup(crashing)).api.download(post({ ...BODY, verbose: true })));
    expect((loud.at(-1)!.data as { stack?: string }).stack).toContain("boom");
  });

  test("rejects a second download while one is running, then recovers", async () => {
    const { source, release } = gated();
    const { api } = await setup(source);
    const firstText = (await api.download(post(BODY))).text();
    const second = await api.download(post({ ...BODY, filename: "other.geojson" }));
    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toContain("still running");
    release();
    expect(parseSSE(await firstText).events.at(-1)!.event).toBe("result");
    expect((await api.download(post({ ...BODY, filename: "third.geojson" }))).status).toBe(200);
  });

  test("bad file names are rejected before anything runs", async () => {
    const { api } = await setup();
    const response = await api.download(post({ ...BODY, filename: "../evil" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Invalid file name");
  });

  test("a client that disconnects mid-download neither crashes the server nor blocks the next download", async () => {
    const { source, release } = gated();
    const { api, dir } = await setup(source, 5);
    const response = await api.download(post(BODY));
    await response.body!.cancel();
    await Bun.sleep(30); // several heartbeats fire against the cancelled stream
    release();
    await Bun.sleep(50);
    expect(await Bun.file(join(dir, "out.geojson")).exists()).toBe(true);
    expect((await api.download(post({ ...BODY, filename: "next.geojson" }))).status).toBe(200);
  });

  test("sends heartbeat comments while a download is quiet", async () => {
    const { source, release } = gated();
    const { api } = await setup(source, 10);
    const text = (await api.download(post(BODY))).text();
    await Bun.sleep(60);
    release();
    expect(await text).toContain(": ping");
  });
});

describe("files and validation", () => {
  test("lists saved files newest first and serves them, with an optional download header", async () => {
    const { api } = await setup();
    await (await api.download(post({ ...BODY, filename: "a.geojson" }))).text();
    await Bun.sleep(15);
    await (await api.download(post({ ...BODY, filename: "b.geojson" }))).text();
    const list = await (await api.files()).json();
    expect(list.map((f: { name: string }) => f.name)).toEqual(["b.geojson", "a.geojson"]);
    const inline = await api.file("a.geojson", false);
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect((await inline.json()).type).toBe("FeatureCollection");
    expect((await api.file("a.geojson", true)).headers.get("content-disposition")).toContain('filename="a.geojson"');
  });

  test("a missing file is a 404 and a traversal attempt a 400", async () => {
    const { api } = await setup();
    expect((await api.file("nope.geojson", false)).status).toBe(404);
    expect((await api.file("..%2F..%2Fsecret", false)).status).toBe(400);
  });

  test("validates uploaded text and saved files, honoring strict", async () => {
    const { api } = await setup();
    await (await api.download(post(BODY))).text();
    const saved = await (await api.validate(post({ file: "out.geojson" }))).json();
    expect(saved.failed).toBe(false);
    expect(saved.report.featureCount).toBe(3);

    const crossed = JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]]] } }],
    });
    expect((await (await api.validate(post({ text: crossed }))).json()).failed).toBe(false);
    expect((await (await api.validate(post({ text: crossed, strict: true }))).json()).failed).toBe(true);
    expect((await (await api.validate(post({ text: "{nope" }))).json()).failed).toBe(true);
  });

  test("validates an uploaded file sent as the raw request body, honoring ?strict", async () => {
    const { api } = await setup();
    const crossed = JSON.stringify({
      type: "FeatureCollection",
      attribution: "x",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]]] } }],
    });
    const upload = (query = "") => new Request(`http://x/api/validate-upload${query}`, { method: "POST", body: new Blob([crossed]) });
    const lenient = await (await api.validateUpload(upload())).json();
    expect([lenient.failed, lenient.report.featureCount, lenient.report.warned]).toEqual([false, 1, true]);
    expect((await (await api.validateUpload(upload("?strict"))).json()).failed).toBe(true);
    const broken = await (await api.validateUpload(new Request("http://x/api/validate-upload", { method: "POST", body: "{nope" }))).json();
    expect(broken.failed).toBe(true);
  });

  test("an upload with no body is a clear error", async () => {
    const { api } = await setup();
    const response = await api.validateUpload(new Request("http://x/api/validate-upload", { method: "POST" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Nothing to validate");
  });

  test("validate errors: nothing to check, unknown file, bad name", async () => {
    const { api } = await setup();
    const cases: [object, string][] = [
      [{}, "Nothing to validate"],
      [{ file: "ghost.geojson" }, "No saved file"],
      [{ file: "../x" }, "Invalid file name"],
    ];
    for (const [body, message] of cases) {
      const response = await api.validate(post(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toContain(message);
    }
  });
});

describe("preview and estimate endpoints", () => {
  const download = async (api: Awaited<ReturnType<typeof setup>>["api"], filename = "out.geojson") =>
    events(await api.download(post({ ...BODY, filename })));

  test("a download also saves a sidecar that /api/preview returns with the file size", async () => {
    const { api, dir } = await setup(fakeSource(5));
    await download(api);
    const body = await (await api.preview("out.geojson")).json();
    expect(body.size).toBe(Bun.file(join(dir, "out.geojson")).size);
    expect(body.sidecar).toMatchObject({ count: 5, bytes: body.size, bbox: BODY.bbox });
    expect(body.sidecar.sample).toHaveLength(5);
  });

  test("the sidecar is not listed as a saved file", async () => {
    const { api } = await setup();
    await download(api);
    expect((await (await api.files()).json()).map((f: { name: string }) => f.name)).toEqual(["out.geojson"]);
  });

  test("a stale sidecar (file changed since) is ignored; no sidecar is fine", async () => {
    const { api, dir } = await setup();
    await download(api);
    await Bun.write(join(dir, "out.geojson"), '{"type":"FeatureCollection","features":[]}');
    expect((await (await api.preview("out.geojson")).json()).sidecar).toBeUndefined();
    await Bun.write(join(dir, "plain.geojson"), "{}");
    expect((await (await api.preview("plain.geojson")).json()).sidecar).toBeUndefined();
  });

  test("preview of a missing file is 404; bad names are refused", async () => {
    const { api } = await setup();
    expect((await api.preview("nope.geojson")).status).toBe(404);
    expect((await api.preview("..%2Fx")).status).toBe(400);
  });

  test("POST /api/estimate returns the estimator's answer and validates input", async () => {
    const dir = await freshDir();
    const seen: unknown[] = [];
    const api = createApi({
      outputDir: dir,
      makeEstimate: (settings) => async (request) => {
        seen.push({ settings: { release: settings.release }, request });
        return { parts: 1, rowGroups: 2, maxRows: 3, readBytes: 4 };
      },
    });
    const ok = await api.estimate(post({ provider: "overture", dataset: "buildings", bbox: [0, 0, 1, 1], release: "R9" }));
    expect(await ok.json()).toEqual({ parts: 1, rowGroups: 2, maxRows: 3, readBytes: 4 });
    expect(seen).toEqual([{ settings: { release: "R9" }, request: { dataset: "buildings", bbox: [0, 0, 1, 1] } }]);
    expect((await api.estimate(post({ provider: "osm", dataset: "buildings", bbox: [0, 0, 1, 1] }))).status).toBe(400);
    expect((await api.estimate(post({ provider: "overture", dataset: "buildings", bbox: [5, 0, 1, 1] }))).status).toBe(400);
  });
});

describe("DELETE /api/files/:name", () => {
  const save = async (api: Awaited<ReturnType<typeof setup>>["api"], filename: string) =>
    events(await api.download(post({ ...BODY, filename })));

  test("removes the file and its preview sidecar, and only that file", async () => {
    const { api, dir } = await setup();
    await save(api, "a.geojson");
    await save(api, "b.geojson");
    const response = await api.remove("a.geojson");
    expect(await response.json()).toEqual({ deleted: "a.geojson" });
    expect(await Bun.file(join(dir, "a.geojson")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "a.geojson.preview.json")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "b.geojson")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "b.geojson.preview.json")).exists()).toBe(true);
    expect((await (await api.files()).json()).map((f: { name: string }) => f.name)).toEqual(["b.geojson"]);
  });

  test("works for a file that has no sidecar", async () => {
    const { api, dir } = await setup();
    await Bun.write(join(dir, "old.geojson"), "{}");
    expect((await api.remove("old.geojson")).status).toBe(200);
    expect(await Bun.file(join(dir, "old.geojson")).exists()).toBe(false);
  });

  test("a missing file is 404; path tricks are refused and delete nothing outside the folder", async () => {
    const { api, dir } = await setup();
    await Bun.write(join(dir, "..", "outside.geojson"), "{}");
    expect((await api.remove("nope.geojson")).status).toBe(404);
    for (const name of ["..%2Foutside.geojson", "..%5Coutside.geojson", "a%2Fb.geojson"]) {
      expect((await api.remove(name)).status).toBe(400);
    }
    expect(await Bun.file(join(dir, "..", "outside.geojson")).exists()).toBe(true);
  });
});

describe("download formats", () => {
  const run = async (format: string, filename: string, count = 3) => {
    const { api, dir } = await setup(fakeSource(count));
    const seen = await events(await api.download(post({ ...BODY, format, filename })));
    return { api, dir, seen };
  };

  test("GET /api/info lists every format with its extension", async () => {
    const { api } = await setup();
    const info = await api.info().json();
    expect(info.formats.map((f: { id: string; extension: string }) => [f.id, f.extension])).toEqual([
      ["geojson", ".geojson"], ["geojsonseq", ".geojsonl"], ["geoparquet", ".parquet"], ["kml", ".kml"],
    ]);
  });

  test.each([
    ["geojsonseq", "out", "out.geojsonl", "application/x-ndjson"],
    ["geoparquet", "out.parquet", "out.parquet", "application/vnd.apache.parquet"],
    ["kml", "out", "out.kml", "application/vnd.google-earth.kml+xml"],
  ])("%s: the name gets the right extension, the file and its preview sidecar are saved", async (format, given, saved, contentType) => {
    const { api, dir, seen } = await run(format, given);
    expect(seen.at(-1)).toMatchObject({ event: "result", data: { filename: saved, featureCount: 3 } });
    expect(await Bun.file(join(dir, saved)).exists()).toBe(true);
    expect((await (await api.files()).json()).map((f: { name: string }) => f.name)).toEqual([saved]);
    const preview = await (await api.preview(saved)).json();
    expect(preview.sidecar).toMatchObject({ count: 3, bytes: preview.size });
    expect((await api.file(saved, false)).headers.get("content-type")).toBe(contentType);
  });

  test("an unknown format is refused before anything is written", async () => {
    const { api, dir } = await setup();
    const response = await api.download(post({ ...BODY, format: "shp" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('Unknown format "shp"');
    expect(await Bun.file(join(dir, "out.geojson")).exists()).toBe(false);
  });

  test("the same base name in two formats does not collide", async () => {
    const { api, dir } = await setup();
    await events(await api.download(post({ ...BODY, format: "geojson", filename: "same" })));
    await events(await api.download(post({ ...BODY, format: "kml", filename: "same" })));
    expect(await Bun.file(join(dir, "same.geojson")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "same.kml")).exists()).toBe(true);
  });

  test("delete also removes the attribution file of a GeoJSONSeq download", async () => {
    const { api, dir } = await run("geojsonseq", "s");
    expect(await Bun.file(join(dir, "s.geojsonl.attribution.txt")).exists()).toBe(true);
    expect((await api.remove("s.geojsonl")).status).toBe(200);
    for (const name of ["s.geojsonl", "s.geojsonl.attribution.txt", "s.geojsonl.preview.json"]) {
      expect(await Bun.file(join(dir, name)).exists()).toBe(false);
    }
  });

  test("only GeoJSON files can be validated; the others are refused with a hint", async () => {
    const { api } = await run("kml", "k");
    const response = await api.validate(post({ file: "k.kml" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Only GeoJSON");
  });
});

describe("safeName with formats", () => {
  test("a known extension is kept, an unknown one is not accepted as a format", () => {
    expect(safeName("a.kml")).toBe("a.kml");
    expect(safeName("a.parquet")).toBe("a.parquet");
    expect(safeName("a.geojsonl")).toBe("a.geojsonl");
    expect(safeName("a.shp")).toBe("a.shp.geojson");
  });
  test("an explicit format decides the extension", () => {
    expect(safeName("a", "kml")).toBe("a.kml");
    expect(safeName("a.kml", "kml")).toBe("a.kml");
    expect(safeName("a.geojson", "geoparquet")).toBe("a.geojson.parquet");
  });
  test.each(["../x", "a/b", ".kml", "sp ace"])("still rejects %j", (name) => {
    expect(() => safeName(name, "kml")).toThrow(BunGisError);
  });
});
