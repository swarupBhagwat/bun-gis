import { createSources, createWriters } from "./compose";
import type { SourceSettings } from "./compose";
import { download as run } from "./core/download";
import type { DownloadDeps } from "./core/download";
import type { DownloadRequest, DownloadResult } from "./core/types";

export type DownloadOptions = Partial<Omit<SourceSettings, "warn">> &
  Partial<DownloadDeps> & { warn?: (message: string) => void };

// Ready-wired entry point for library users; `sources`/`writers` can be replaced to plug in custom ones.
export function download(
  request: DownloadRequest,
  { release, retries, warn = console.warn, sources, writers, progress }: DownloadOptions = {},
): Promise<DownloadResult> {
  return run(request, {
    sources: sources ?? createSources({ release, retries, warn }),
    writers: writers ?? createWriters(),
    progress,
  });
}
