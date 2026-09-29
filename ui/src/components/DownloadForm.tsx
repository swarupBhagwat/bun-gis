import { areaKm2, formatBytes, readBBox, sizeWarning } from "../bbox";
import type { FormState } from "../form";
import type { EstimateState } from "../hooks/useEstimate";
import { describeEstimate } from "../preview";
import type { Info, SavedFile } from "../types";

interface Props {
  info: Info;
  form: FormState;
  /** The saved file the current file name would write to, if there is one. */
  existing?: SavedFile;
  estimate: EstimateState;
  running: boolean;
  drawing: boolean;
  onChange(patch: Partial<FormState>): void;
  onToggleDraw(): void;
  onZoom(): void;
  onSubmit(): void;
}

const LABELS = ["West (min lon)", "South (min lat)", "East (max lon)", "North (max lat)"];

export function DownloadForm({ info, form, existing, estimate, running, drawing, onChange, onToggleDraw, onZoom, onSubmit }: Props) {
  const provider = info.providers.find((p) => p.id === form.provider) ?? info.providers[0]!;
  const { bbox, error } = readBBox(form.fields);
  const warning = bbox && sizeWarning(bbox);
  const retries = form.retries === "" ? undefined : Number(form.retries);
  const retriesInvalid = retries !== undefined && (!Number.isInteger(retries) || retries < 0);
  const canSubmit = !running && !!bbox && !retriesInvalid && form.filename.trim() !== "";

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <h2>Download</h2>

      <div className="row">
        <label>
          Source
          <select value={form.provider} onChange={(e) => onChange({ provider: e.target.value, dataset: info.providers.find((p) => p.id === e.target.value)!.datasets[0]! })}>
            {info.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          Dataset
          <select value={form.dataset} onChange={(e) => onChange({ dataset: e.target.value })}>
            {provider.datasets.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Format
        <select
          value={form.format}
          onChange={(e) => onChange({ format: e.target.value, extension: info.formats.find((f) => f.id === e.target.value)!.extension })}
        >
          {info.formats.map((f) => (
            <option key={f.id} value={f.id}>{f.label} ({f.extension})</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Area (bbox)</legend>
        <div className="grid4">
          {LABELS.map((label, i) => (
            <label key={label}>
              {label}
              <input
                inputMode="decimal"
                value={form.fields[i]}
                aria-label={label}
                onChange={(e) => {
                  const fields = [...form.fields] as FormState["fields"];
                  fields[i] = e.target.value;
                  onChange({ fields });
                }}
              />
            </label>
          ))}
        </div>
        <div className="row">
          <button type="button" className={drawing ? "active" : ""} onClick={onToggleDraw}>
            {drawing ? "Drag on the map…" : "Draw on map"}
          </button>
          <button type="button" onClick={onZoom} disabled={!bbox}>Zoom to area</button>
        </div>
        {error && <p className="msg error">{error}</p>}
        {bbox && <p className="msg muted">≈ {areaKm2(bbox).toFixed(2)} km²</p>}
        {warning && <p className="msg warn">{warning}</p>}
        {bbox && estimate.status === "loading" && <p className="msg muted">Estimating download size…</p>}
        {bbox && estimate.status === "ready" && (() => {
          const { text, large } = describeEstimate(estimate.estimate);
          return <p className={large ? "msg warn" : "msg muted"}>{text}</p>;
        })()}
        {bbox && estimate.status === "error" && <p className="msg muted">Could not estimate the size: {estimate.message}</p>}
      </fieldset>

      <label>
        <span>Save as (in <code>ui/output/</code>)</span>
        <input value={form.filename} onChange={(e) => onChange({ filename: e.target.value })} />
      </label>
      {existing && (
        <p className={form.overwrite ? "msg warn" : "msg muted"} role="status">
          {form.overwrite
            ? `This will replace the existing file (${formatBytes(existing.size)}, saved ${new Date(existing.modified).toLocaleString()}). That cannot be undone.`
            : `A file with this name already exists (${formatBytes(existing.size)}). The download is refused unless "Overwrite" is ticked (under Advanced).`}
        </p>
      )}

      <details>
        <summary>Advanced</summary>
        <label>
          <span>Retries <span className="muted">(default {info.defaults.retries})</span></span>
          <input inputMode="numeric" value={form.retries} placeholder={String(info.defaults.retries)} onChange={(e) => onChange({ retries: e.target.value })} />
        </label>
        {retriesInvalid && <p className="msg error">Retries must be a whole number, 0 or more</p>}
        {form.provider === "overture" && (
          <label>
            <span>Overture release <span className="muted">(empty = latest)</span></span>
            <input value={form.release} placeholder="2026-09-23.1" onChange={(e) => onChange({ release: e.target.value })} />
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.overwrite} onChange={(e) => onChange({ overwrite: e.target.checked })} />
          Overwrite if the file exists
        </label>
        <label className="check">
          <input type="checkbox" checked={form.verbose} onChange={(e) => onChange({ verbose: e.target.checked })} />
          Verbose log (settings, error details)
        </label>
      </details>

      <button type="submit" className="primary" disabled={!canSubmit}>
        {running ? "Downloading…" : "Download"}
      </button>
    </form>
  );
}
