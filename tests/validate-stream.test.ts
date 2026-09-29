import { describe, expect, test } from "bun:test";
import { checkGeoJSON } from "../src/validate/check";
import { checkGeoJSONFile, checkGeoJSONStream } from "../src/validate/stream";
import { FeatureSplitter, ScanError } from "../src/validate/splitter";
import { tempPath } from "./fixtures";

const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const CW = [...CCW].reverse();
const CROSSED = [[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]];

// Bytes, not characters: a chunk size of 1 cuts multi-byte characters in half, which the decoder must survive.
async function* chunked(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

const SIZES = [1, 2, 3, 5, 7, 64, 1000, 1_000_000];

const feature = (coordinates: unknown, extra: object = {}, type = "Polygon") => ({
  type: "Feature",
  properties: {},
  geometry: { type, coordinates },
  ...extra,
});

async function expectSameVerdict(text: string) {
  const whole = checkGeoJSON(text);
  for (const size of SIZES) {
    const streamed = await checkGeoJSONStream(chunked(text, size));
    expect(streamed, `chunk size ${size}`).toEqual(whole);
  }
  return whole;
}

const nasty = 'a]b,c}d[e{f\\"g\\\\ \\u00e9 café 日本語 😀 :';

describe("streaming gives the same verdict as checking the whole document", () => {
  const corpus: [string, string][] = [
    ["a clean collection with ids and attribution", JSON.stringify({ type: "FeatureCollection", attribution: "© t", source: "T", features: [feature([CCW], { id: "a" }), feature([CCW], { id: "b" })] })],
    ["brackets, commas, quotes and non-ASCII inside strings", JSON.stringify({ type: "FeatureCollection", attribution: "© café 日本語 😀", features: [feature([CCW], { properties: { name: nasty, list: ["]", "}", ","], nested: { "}": "{" } } })] })],
    ["members before and after the features, nested and scalar ones", '{"type":"FeatureCollection","count": 5 ,"flag":true,"nothing":null,"bbox":[0,0,1,1],"meta":{"a":[1,{"b":"]"}],"c":"}"},"features":[' + JSON.stringify(feature([CCW])) + '],"attribution":"late","source":"S","tail":-1.5e3}'],
    ["pretty-printed with CRLF line endings", JSON.stringify({ type: "FeatureCollection", attribution: "x", features: [feature([CCW]), feature(null as never, {}, "Point")] }, null, 2).replace(/\n/g, "\r\n")],
    ["empty features", '{"type":"FeatureCollection","attribution":"x","features":[]}'],
    ["empty features with whitespace", '{ "type" : "FeatureCollection" , "features" : [ \n ] }'],
    ["rule findings: winding, crossing, range, duplicates, malformed, null geometry", JSON.stringify({ type: "FeatureCollection", attribution: "x", features: [
      feature([CW], { id: "cw" }), feature([CROSSED], { id: "x" }), feature([[[0, 0], [181, 0], [1, 1], [0, 0]]], { id: "far" }),
      feature([CCW], { id: "dup" }), feature([CCW], { id: "dup" }), { type: "Feature", geometry: null },
      { type: "Feature", geometry: { type: "Circle", coordinates: [] }, properties: {} }, feature(null as never, { geometry: null }),
    ] })],
    ["a single Feature (checked as a whole)", JSON.stringify(feature([CCW], { id: "one" }))],
    ["a bare geometry (checked as a whole)", JSON.stringify({ type: "Polygon", coordinates: [CCW] })],
    ["a collection with no type", '{"features":[' + JSON.stringify(feature([CCW], { id: "a" })) + ']}'],
    ["a collection with a wrong type and a bad feature", '{"type":"Nope","attribution":"x","features":[' + JSON.stringify(feature([CCW], { id: "a" })) + ',{"type":"Feature"}]}'],
    ["features that is not an array", '{"type":"FeatureCollection","features":{}}'],
    ["invalid JSON", "{nope"],
    ["a root array", "[]"],
    ["garbage before the features", '{"type":"FeatureCollection", oops, "features":[]}'],
    ["empty input", ""],
    ["whitespace only", "  \n "],
  ];

  test.each(corpus)("%s", async (_name, text) => {
    await expectSameVerdict(text);
  });

  test("a randomized collection of 1,500 mixed features, pretty and compact, at awkward chunk sizes", async () => {
    let seed = 20260929;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const names = ["plain", nasty, "日本語", "😀😀", 'quote"inside', "back\\slash", ""];
    const features = Array.from({ length: 1500 }, (_, i) => {
      const x = Math.floor(random() * 100), y = Math.floor(random() * 100);
      const square = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]];
      const properties = { name: names[Math.floor(random() * names.length)], n: i, deep: { a: [1, [2, { b: "]" }]] } };
      const r = random();
      const id = r < 0.05 ? "dup" : `f${i}`;
      if (r < 0.70) return feature([square], { id, properties });
      if (r < 0.78) return feature([[...square].reverse()], { id, properties });
      if (r < 0.83) return feature([CROSSED], { id, properties });
      if (r < 0.87) return feature([[[0, 0], [999, 0], [1, 1], [0, 0]]], { id, properties });
      if (r < 0.91) return { type: "Feature", id, geometry: { type: "Point", coordinates: [x, y] } };
      if (r < 0.95) return feature(null as never, { id, properties, geometry: null });
      return feature([x, y], { id, properties }, "Point");
    });
    for (const indent of [undefined, 2]) {
      const text = JSON.stringify({ type: "FeatureCollection", attribution: "© ★", source: "R", features }, null, indent);
      for (const size of [1, 13, 4096]) {
        expect(await checkGeoJSONStream(chunked(text, size)), `indent ${indent}, chunk ${size}`).toEqual(checkGeoJSON(text));
      }
    }
  });
});

describe("damaged input inside the features array is reported, and what was readable is still checked", () => {
  const head = '{"type":"FeatureCollection","attribution":"x","features":[';
  const good = JSON.stringify(feature([CCW], { id: "ok" }));
  const crossed = JSON.stringify(feature([CROSSED], { id: "crossed" }));
  const structure = (report: Awaited<ReturnType<typeof checkGeoJSONStream>>) => report.checks[0]!;

  test("a truncated file reports where it broke and still checks the earlier features", async () => {
    const text = head + good + "," + crossed + "," + good.slice(0, 40);
    for (const size of [1, 9, 1000]) {
      const report = await checkGeoJSONStream(chunked(text, size));
      expect(report.failed).toBe(true);
      expect(structure(report).examples[0]).toContain("unexpected end of input");
      expect(structure(report).examples[0]).toContain("after 2 feature(s)");
      expect(report.checks.find((c) => c.name === "Geometry validity")!.examples[0]).toContain("crossed");
    }
  });

  test.each([
    ["a feature that is not valid JSON", head + good + ',{"type":"Feature",},' + good + "]}", "#1: Invalid JSON"],
    ["a trailing comma", head + good + ",]}", "#1: Invalid JSON"],
    ["a doubled comma", head + good + ",," + good + "]}", "#1: Invalid JSON"],
    ["a leading comma", head + "," + good + "]}", "#0: Invalid JSON"],
    ["a scalar element", head + "42," + good + "]}", '#0: expected an object of type "Feature"'],
  ])("%s", async (_name, text, message) => {
    const report = await checkGeoJSONStream(chunked(text, 3));
    expect(report.failed).toBe(true);
    expect(structure(report).examples[0]).toContain(message);
    expect(report.featureCount).toBeGreaterThanOrEqual(2);
  });

  test("mismatched brackets and trailing garbage are reported", async () => {
    const mismatched = await checkGeoJSONStream(chunked(head + good + "}", 5));
    expect(structure(mismatched).examples[0]).toContain("mismatched brackets");
    const trailing = await checkGeoJSONStream(chunked(head + good + "]} extra", 5));
    expect(structure(trailing).examples[0]).toContain('unexpected character "e"');
  });

  test("a wrong or missing root type is reported without discarding the results", async () => {
    const wrong = await checkGeoJSONStream(chunked('{"type":"Nope","features":[' + good + "]}", 4));
    expect(structure(wrong).examples[0]).toContain('root type is "Nope"');
    expect(wrong.featureCount).toBe(1);
    const missing = await checkGeoJSONStream(chunked('{"features":[' + good + "]}", 4));
    expect(structure(missing).examples[0]).toContain('missing "type"');
  });

  test("string chunks work as well as bytes", async () => {
    async function* strings() {
      yield head + good.slice(0, 20);
      yield good.slice(20) + "]}";
    }
    const report = await checkGeoJSONStream(strings());
    expect(report.failed).toBe(false);
    expect(report.featureCount).toBe(1);
  });
});

describe("files", () => {
  test("checkGeoJSONFile reads from disk and matches the in-memory verdict", async () => {
    const text = JSON.stringify({ type: "FeatureCollection", attribution: "© 日本", features: [feature([CCW], { id: "a" }), feature([CROSSED], { id: "b" })] });
    const path = await tempPath("f.geojson");
    await Bun.write(path, text);
    expect(await checkGeoJSONFile(path)).toEqual(checkGeoJSON(text));
  });

  test("a UTF-8 byte order mark at the start of a file is ignored", async () => {
    const path = await tempPath("bom.geojson");
    await Bun.write(path, "﻿" + JSON.stringify({ type: "FeatureCollection", attribution: "x", features: [feature([CCW])] }));
    const report = await checkGeoJSONFile(path);
    expect(report.failed).toBe(false);
    expect(report.featureCount).toBe(1);
  });

  test("a feature bigger than any single chunk is handled", async () => {
    const ring = Array.from({ length: 5000 }, (_, i) => [Math.cos(i / 800), Math.sin(i / 800)]);
    ring.push(ring[0]!);
    const text = JSON.stringify({ type: "FeatureCollection", attribution: "x", features: [feature([ring], { id: "big" })] });
    expect(text.length).toBeGreaterThan(100_000);
    const report = await checkGeoJSONStream(chunked(text, 256));
    expect(report.featureCount).toBe(1);
    expect(report.geometryTypes).toEqual({ Polygon: 1 });
  });
});

describe("FeatureSplitter", () => {
  function run(text: string, size: number) {
    const members: [string, unknown][] = [];
    const elements: string[] = [];
    const splitter = new FeatureSplitter({ member: (k, v) => members.push([k, v]), element: (t) => elements.push(t) });
    for (let i = 0; i < text.length; i += size) splitter.push(text.slice(i, i + size));
    splitter.end();
    return { members, elements };
  }

  test("cuts elements and members at any chunk size", () => {
    const text = '{"a":1,"features":[{"x":"]"},[1,2],"s",3],"z":{"k":[}]}}'.replace("[}]", '"}"');
    for (const size of [1, 2, 3, 100]) {
      const { members, elements } = run(text, size);
      expect(elements).toEqual(['{"x":"]"}', "[1,2]", '"s"', "3"]);
      expect(members).toEqual([["a", 1], ["z", { k: "}" }]]);
    }
  });

  test("end() rejects an unfinished document", () => {
    const splitter = new FeatureSplitter({ member() {}, element() {} });
    splitter.push('{"features":[{"a":1}');
    expect(() => splitter.end()).toThrow(ScanError);
  });

  test("errors carry the character offset across chunks", () => {
    const splitter = new FeatureSplitter({ member() {}, element() {} });
    splitter.push('{"a":1');
    try {
      splitter.push(",  ?");
      throw new Error("expected a ScanError");
    } catch (error) {
      expect(error).toBeInstanceOf(ScanError);
      expect((error as ScanError).offset).toBe(9);
    }
  });
});

describe("flagged features when streamed", () => {
  test("match the whole-document check exactly, whatever the chunk size", async () => {
    const CW = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const features = Array.from({ length: 30 }, (_, i) => ({
      type: "Feature", id: i % 7 === 0 ? "dup" : `f${i}`, properties: {}, geometry: { type: "Polygon", coordinates: [i % 3 ? CW : [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] },
    }));
    const text = JSON.stringify({ type: "FeatureCollection", features });
    const whole = checkGeoJSON(text);
    expect(whole.flaggedCount).toBeGreaterThan(10);
    for (const size of [1, 7, 64, 100000]) {
      const streamed = await checkGeoJSONStream(chunked(text, size));
      expect(streamed.flagged, `chunk ${size}`).toEqual(whole.flagged);
      expect(streamed.flaggedCount).toBe(whole.flaggedCount);
    }
  });
});
