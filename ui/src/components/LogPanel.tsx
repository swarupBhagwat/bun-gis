import { useEffect, useState } from "react";
import { fileUrl } from "../api";
import { formatBytes } from "../bbox";
import { isGeoJSON } from "../preview";
import type { DownloadOutcome, LogLine } from "../types";

interface Props {
  lines: LogLine[];
  running: boolean;
  outcome?: DownloadOutcome;
  onValidate(name: string): void;
}

const ICON = { info: "•", warn: "⚠", debug: "·", error: "✗" } as const;

function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

export function LogPanel({ lines, running, outcome, onValidate }: Props) {
  const elapsed = useElapsed(running);
  if (!lines.length && !running && !outcome) return null;
  return (
    <div className="card" aria-live="polite">
      <h2>
        Progress {running && <span className="spinner" aria-label="running" />}
        {running && <span className="muted">{elapsed}s</span>}
      </h2>
      <ul className="log">
        {lines.map((line, i) => (
          <li key={i} className={line.level}>
            <span aria-hidden>{ICON[line.level]}</span> {line.text}
            {line.hint && <pre className="hint">{line.hint}</pre>}
          </li>
        ))}
      </ul>
      {outcome && (
        <div className="success">
          <p>
            ✓ <strong>{outcome.featureCount.toLocaleString("en-US")}</strong> features · {formatBytes(outcome.bytes)} ·{" "}
            {(outcome.elapsedMs / 1000).toFixed(1)}s → <code>{outcome.filename}</code>
          </p>
          <div className="row">
            <a className="button" href={fileUrl(outcome.filename, true)}>Download file</a>
            {isGeoJSON(outcome.filename) && <button type="button" onClick={() => onValidate(outcome.filename)}>Validate</button>}
          </div>
        </div>
      )}
    </div>
  );
}
