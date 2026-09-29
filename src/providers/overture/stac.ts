import { intersects } from "../../bbox/bbox";
import type { BBox } from "../../bbox/bbox";
import { BunGisError, HttpError } from "../../core/errors";
import type { OvertureDataset } from "./datasets";
import { createGet } from "./http";
import type { Get } from "./http";
import type { OvertureCatalog, PartFile } from "./types";

const STAC = "https://stac.overturemaps.org";

interface Link {
  rel: string;
  href: string;
}
interface Collection {
  extent: { spatial: { bbox: BBox[] } };
  links: Link[];
}
interface Item {
  bbox: BBox;
  assets: { aws: { href: string } };
}

export interface StacCatalogOptions {
  release?: string;
  get?: Get;
}

// Overture splits a type into hundreds of ~500 MB parquet files; STAC lists each file's bbox,
// so only the few files under the requested bbox are ever opened.
export class StacCatalog implements OvertureCatalog {
  private readonly get: Get;
  private resolved?: Promise<string>;

  constructor({ release, get = createGet() }: StacCatalogOptions = {}) {
    this.get = get;
    if (release) this.resolved = Promise.resolve(release);
  }

  release(): Promise<string> {
    this.resolved ??= this.json<{ latest: string }>(`${STAC}/catalog.json`).then(
      (catalog) => catalog.latest,
      (error) => {
        this.resolved = undefined;
        throw error;
      },
    );
    return this.resolved;
  }

  async findParts({ theme, type }: OvertureDataset, bbox: BBox): Promise<PartFile[]> {
    const release = await this.release();
    const collection = await this.collection(release, theme, type);

    const fileBoxes = collection.extent.spatial.bbox.slice(1); // entry 0 is the union of all files
    const items = collection.links.filter((link) => link.rel === "item");
    if (fileBoxes.length !== items.length) {
      throw new BunGisError(
        `Unexpected STAC layout for ${theme}/${type} in release ${release}`,
        `${items.length} items but ${fileBoxes.length} file bboxes.`,
      );
    }

    const hits = items.flatMap((link, i) => (intersects(fileBoxes[i]!, bbox) ? [{ link, box: fileBoxes[i]! }] : []));
    return Promise.all(
      hits.map(async ({ link, box }) => {
        const item = await this.json<Item>(link.href);
        if (item.bbox.join() !== box.join()) {
          throw new BunGisError(`STAC item ${link.href} does not match its collection entry`);
        }
        return { url: item.assets.aws.href, bbox: item.bbox };
      }),
    );
  }

  private async collection(release: string, theme: string, type: string): Promise<Collection> {
    try {
      return await this.json<Collection>(`${STAC}/${release}/${theme}/${type}/collection.json`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new BunGisError(
          `Overture release "${release}" has no ${theme}/${type} data`,
          `Check the release id, or omit it to use the latest (${STAC}/catalog.json).`,
        );
      }
      throw error;
    }
  }

  private async json<T>(url: string): Promise<T> {
    return (await this.get(url)).json() as Promise<T>;
  }
}
