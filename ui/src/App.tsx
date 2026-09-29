import { useEffect, useMemo, useState } from "react";
import type { PreviewSidecar } from "../server/preview";
import { deleteFile, getInfo, getPreview, loadGeoJSON } from "./api";
import { formatBytes, formatCoord, readBBox } from "./bbox";
import { DownloadForm } from "./components/DownloadForm";
import { FilesPanel } from "./components/FilesPanel";
import { LogPanel } from "./components/LogPanel";
import { MapView } from "./components/MapView";
import { ValidatePanel } from "./components/ValidatePanel";
import { applyChange, initialForm, savedName, toDownloadBody } from "./form";
import type { FormState } from "./form";
import { useDownload } from "./hooks/useDownload";
import { useEstimate } from "./hooks/useEstimate";
import { useFiles } from "./hooks/useFiles";
import { choosePreview, isGeoJSON } from "./preview";
import { useValidation } from "./hooks/useValidation";
import type { BBox, GeoJSONData, Info } from "./types";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App() {
  const [info, setInfo] = useState<Info>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState<FormState>(initialForm);
  const [drawing, setDrawing] = useState(false);
  const [zoomToken, setZoomToken] = useState(1);
  const [preview, setPreview] = useState<{ key: string; name: string; size: number; data?: GeoJSONData; sidecar?: PreviewSidecar }>();

  const files = useFiles(setNotice);
  const validation = useValidation();

  // Big files are drawn from the small sidecar written at download time; "force" loads the whole file anyway.
  const previewFile = async (name: string, force = false) => {
    try {
      const { size, sidecar } = await getPreview(name);
      const mode = force && isGeoJSON(name) ? "full" : choosePreview(name, size, sidecar);
      const data =
        mode === "full" ? await loadGeoJSON(name) : mode === "all" ? { type: "FeatureCollection" as const, features: sidecar!.sample } : undefined;
      setPreview({ key: `${name}-${Date.now()}`, name, size, data, sidecar: mode === "sample" ? sidecar : undefined });
      setNotice(undefined);
    } catch (error) {
      setNotice(`Cannot preview ${name}: ${message(error)}`);
    }
  };

  const removeFile = async (name: string) => {
    try {
      await deleteFile(name);
      if (preview?.name === name) setPreview(undefined);
      setNotice(undefined);
    } catch (error) {
      setNotice(`Cannot delete ${name}: ${message(error)}`);
    }
    files.refresh();
  };

  // Highlights follow the latest validation; "hide" lasts until the next one. `?.` because a server started before this feature returns reports without `flagged`.
  const [flagsHidden, setFlagsHidden] = useState(false);
  useEffect(() => setFlagsHidden(false), [validation.outcome]);
  const flagged = useMemo(
    () => (flagsHidden || !validation.outcome?.report.flagged?.length ? undefined : validation.outcome.report.flagged),
    [flagsHidden, validation.outcome],
  );

  const download = useDownload({ onSettled: files.refresh, onFinished: previewFile });

  useEffect(() => {
    getInfo().then(setInfo, (error) => setNotice(`Cannot reach the local server: ${message(error)}`));
  }, []);

  const change = (patch: Partial<FormState>) => setForm((current) => applyChange(current, patch));
  const bbox = readBBox(form.fields).bbox;
  const estimate = useEstimate(bbox, form.provider, form.dataset, form.release);

  const submit = () => {
    const body = toDownloadBody(form);
    if (!body) return;
    setDrawing(false);
    download.start(body);
  };

  const draw = (drawn: BBox) => {
    change({ fields: drawn.map(formatCoord) as FormState["fields"] });
    setDrawing(false);
  };

  return (
    <div className="app">
      <aside className="side">
        <header>
          <h1>bun-gis</h1>
          <span className="muted">{info ? `v${info.version} · local UI` : "connecting…"}</span>
        </header>
        {notice && <p className="msg error" role="alert">{notice}</p>}
        {info && (
          <DownloadForm
            info={info}
            form={form}
            existing={files.files.find((file) => file.name === savedName(form.filename, form.extension))}
            estimate={estimate}
            running={download.running}
            drawing={drawing}
            onChange={change}
            onToggleDraw={() => setDrawing((d) => !d)}
            onZoom={() => setZoomToken((t) => t + 1)}
            onSubmit={submit}
          />
        )}
        <LogPanel lines={download.lines} running={download.running} outcome={download.outcome} onValidate={validation.validateSaved} />
        <FilesPanel
          files={files.files}
          previewing={preview?.name}
          onPreview={(name) => previewFile(name)}
          onValidate={validation.validateSaved}
          onDelete={removeFile}
          onRefresh={files.refresh}
        />
        <ValidatePanel
          outcome={validation.outcome}
          strict={validation.strict}
          busy={validation.busy}
          error={validation.error}
          onStrict={validation.setStrict}
          onUpload={validation.validateUpload}
        />
      </aside>
      <main className={drawing ? "stage drawing" : "stage"}>
        <MapView bbox={bbox} drawing={drawing} zoomToken={zoomToken} preview={preview} flagged={flagged} onDraw={draw} />
        {flagged && validation.outcome && (
          <div className="chip top" role="status">
            {`${flagged.filter((f) => f.severity === "fail").length} errors, ${flagged.filter((f) => f.severity === "warn").length} warnings highlighted`}
            {validation.outcome.report.flaggedCount > flagged.length &&
              ` (first ${flagged.length} of ${validation.outcome.report.flaggedCount.toLocaleString("en-US")})`}
            <button type="button" className="link" onClick={() => setFlagsHidden(true)}>hide</button>
          </div>
        )}
        {preview && (
          <div className="chip">
            {preview.data
              ? `${preview.name} · ${preview.data.features.length.toLocaleString("en-US")} features`
              : preview.sidecar
                ? `${preview.name} · sample of ${preview.sidecar.sample.length.toLocaleString("en-US")} of ${preview.sidecar.count.toLocaleString("en-US")} features, with density grid`
                : isGeoJSON(preview.name)
                  ? `${preview.name} · ${formatBytes(preview.size)} is too large to draw`
                  : `${preview.name} · no map preview for this file (its preview data is missing)`}
            {!preview.data && (
              isGeoJSON(preview.name) && (
                <button type="button" className="link" onClick={() => previewFile(preview.name, true)}>
                  {preview.sidecar ? `load all (${formatBytes(preview.size)})` : "preview anyway"}
                </button>
              )
            )}
            <button type="button" className="link" onClick={() => setPreview(undefined)}>clear</button>
          </div>
        )}
      </main>
    </div>
  );
}
