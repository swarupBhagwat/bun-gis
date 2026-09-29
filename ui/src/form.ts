import type { OutputFormat } from "bun-gis";
import type { DownloadBody } from "../server/api";
import { DEFAULT_BBOX, formatCoord, readBBox } from "./bbox";

export interface FormState {
  provider: string;
  dataset: string;
  format: string;
  /** The format's file extension, kept beside it so default names can follow it without the server's format list. */
  extension: string;
  fields: [string, string, string, string];
  filename: string;
  overwrite: boolean;
  retries: string;
  release: string;
  verbose: boolean;
}

// The area is part of the default name, so a new area never lands on top of an earlier download.
export function defaultName(provider: string, dataset: string, fields: readonly string[], extension = ".geojson"): string {
  const { bbox } = readBBox([...fields]);
  return bbox ? `${provider}-${dataset}-${bbox.map(formatCoord).join("_")}${extension}` : `${provider}-${dataset}${extension}`;
}

/** The file name the server will actually use (it appends the format's extension when missing). */
export const savedName = (name: string, extension = ".geojson") =>
  name.trim().endsWith(extension) ? name.trim() : `${name.trim()}${extension}`;

const initialFields = DEFAULT_BBOX.map(formatCoord) as FormState["fields"];

export const initialForm: FormState = {
  provider: "overture",
  dataset: "buildings",
  format: "geojson",
  extension: ".geojson",
  fields: initialFields,
  filename: defaultName("overture", "buildings", initialFields),
  overwrite: false,
  retries: "",
  release: "",
  verbose: false,
};

// The file name follows the source, dataset and area until the user types their own.
export function applyChange(current: FormState, patch: Partial<FormState>): FormState {
  const next = { ...current, ...patch };
  const wasDefault = current.filename === defaultName(current.provider, current.dataset, current.fields, current.extension);
  if (wasDefault && !("filename" in patch)) next.filename = defaultName(next.provider, next.dataset, next.fields, next.extension);
  return next;
}

/** The request for the server, or undefined while the bbox fields are not a valid area. */
export function toDownloadBody(form: FormState): DownloadBody | undefined {
  const { bbox } = readBBox(form.fields);
  if (!bbox) return undefined;
  return {
    provider: form.provider,
    dataset: form.dataset,
    format: form.format as OutputFormat,
    bbox,
    filename: form.filename,
    overwrite: form.overwrite,
    retries: form.retries === "" ? undefined : Number(form.retries),
    release: form.provider === "overture" ? form.release.trim() || undefined : undefined,
    verbose: form.verbose,
  };
}
