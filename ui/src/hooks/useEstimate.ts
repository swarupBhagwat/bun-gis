import { useEffect, useState } from "react";
import { estimateDownload } from "../api";
import type { BBox, Estimate } from "../types";

export type EstimateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; estimate: Estimate }
  | { status: "error"; message: string };

const DEBOUNCE_MS = 700;

// Reads only Parquet footers on the server; re-runs (debounced) when the area, dataset or release changes.
export function useEstimate(bbox: BBox | undefined, provider: string, dataset: string, release: string): EstimateState {
  const [state, setState] = useState<EstimateState>({ status: "idle" });
  const key = bbox ? `${provider}|${dataset}|${release}|${bbox.join()}` : "";

  useEffect(() => {
    if (!bbox || provider !== "overture") {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      estimateDownload({ provider, dataset, bbox, release: release.trim() || undefined }, controller.signal).then(
        (estimate) => setState({ status: "ready", estimate }),
        (error) => {
          if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already captures every input, and bbox is a fresh array each render
  }, [key]);

  return state;
}
