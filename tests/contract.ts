import { describe, expect, test } from "bun:test";
import { BunGisError } from "../src/core/errors";
import type { FeatureSource } from "../src/core/ports";
import type { DownloadRequest, GeoFeature } from "../src/core/types";

const request = (dataset: string): DownloadRequest => ({
  source: "x", dataset, bbox: [0, 0, 1, 1], output: "unused.geojson",
});

// Every FeatureSource must honor the same contract, so callers never special-case a provider.
export function describeFeatureSourceContract(name: string, make: () => FeatureSource) {
  describe(`${name} honors the FeatureSource contract`, () => {
    test("accepts the buildings dataset and rejects unknown ones with a BunGisError listing choices", () => {
      const source = make();
      expect(() => source.validateRequest(request("buildings"))).not.toThrow();
      for (const bad of ["nope", "constructor"]) {
        const error = (() => { try { source.validateRequest(request(bad)); } catch (e) { return e; } })();
        expect(error).toBeInstanceOf(BunGisError);
        expect((error as BunGisError).hint).toContain("buildings");
      }
    });

    test("metadata names the source, an attribution and a license", async () => {
      const meta = await make().metadata(request("buildings"));
      expect(meta.source).not.toBe("");
      expect(meta.attribution).toContain("http");
      expect(meta.license).toBeTruthy();
    });

    test("download yields JSON-serializable GeoJSON features with ids and finite geometry", async () => {
      const features: GeoFeature[] = [];
      for await (const f of make().download(request("buildings"))) features.push(f);
      expect(features.length).toBeGreaterThan(0);
      for (const f of features) {
        expect(f.type).toBe("Feature");
        expect(f.id).toBeDefined();
        expect(f.geometry.type).toMatch(/Polygon|LineString|Point/);
        expect(typeof f.properties).toBe("object");
        expect(() => JSON.stringify(f)).not.toThrow();
        expect(JSON.stringify(f.geometry.coordinates)).not.toMatch(/null|NaN/);
      }
    });
  });
}
