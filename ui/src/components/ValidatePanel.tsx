import { useEffect, useRef } from "react";
import type { ValidationOutcome } from "../types";
import { ReportView } from "./ReportView";

interface Props {
  outcome?: ValidationOutcome;
  strict: boolean;
  busy: boolean;
  error?: string;
  onStrict(strict: boolean): void;
  onUpload(file: File): void;
}

export function ValidatePanel({ outcome, strict, busy, error, onStrict, onUpload }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // The report sits at the bottom of a scrolling sidebar; bring a fresh result into view.
  useEffect(() => {
    if (outcome) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [outcome]);
  return (
    <div className="card" ref={card}>
      <h2>Validate GeoJSON {busy && <span className="spinner" aria-label="validating" />}</h2>
      <p className="muted">Check any file: syntax, RFC 7946 rules, winding order and self-intersections. Use “Validate” on a saved file, or upload one.</p>
      <div className="row">
        <button type="button" onClick={() => input.current?.click()}>Upload a file…</button>
        <input
          ref={input}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
        <label className="check">
          <input type="checkbox" checked={strict} onChange={(e) => onStrict(e.target.checked)} />
          Strict (warnings fail)
        </label>
      </div>
      {error && <p className="msg error">{error}</p>}
      {outcome && <ReportView outcome={outcome} strict={strict} />}
    </div>
  );
}
