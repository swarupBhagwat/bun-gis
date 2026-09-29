import type { DownloadBody, EstimateBody } from "../server/api";
import type { PreviewSidecar } from "../server/preview";
import { parseSSE } from "./sse";
import type { SseEvent } from "./sse";
import type { Estimate, GeoJSONData, Info, Report, SavedFile } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(body?.error?.message ?? `HTTP ${response.status}`, body?.error?.hint);
  }
  return response.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const getInfo = () => request<Info>("/api/info");
export const listFiles = () => request<SavedFile[]>("/api/files");
export const getPreview = (name: string) =>
  request<{ size: number; sidecar?: PreviewSidecar }>(`/api/preview/${encodeURIComponent(name)}`);
export const estimateDownload = (body: EstimateBody, signal: AbortSignal) =>
  request<Estimate>("/api/estimate", { ...post(body), signal });
export const deleteFile = (name: string) =>
  request<{ deleted: string }>(`/api/files/${encodeURIComponent(name)}`, { method: "DELETE" });
export const loadGeoJSON = (name: string) => request<GeoJSONData>(fileUrl(name));
export const fileUrl = (name: string, download = false) =>
  `/api/files/${encodeURIComponent(name)}${download ? "?download" : ""}`;

export const validate = (body: { text?: string; file?: string; strict: boolean }) =>
  request<{ report: Report; failed: boolean }>("/api/validate", post(body));

export const validateUpload = (file: File, strict: boolean) =>
  request<{ report: Report; failed: boolean }>(`/api/validate-upload${strict ? "?strict" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file, // the browser streams a File from disk; it is never read into JS memory
  });

// The download endpoint answers with server-sent events; fetch is used because EventSource cannot POST.
export async function startDownload(body: DownloadBody, onEvent: (event: SseEvent) => void): Promise<void> {
  const response = await fetch("/api/download", post(body));
  if (!response.ok || !response.body) {
    const failure = await response.json().catch(() => undefined);
    onEvent({ event: "error", data: failure?.error ?? { message: `HTTP ${response.status}` } });
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const parsed = parseSSE(buffer + value);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
