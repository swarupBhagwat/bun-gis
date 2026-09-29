import { useState } from "react";
import { fileUrl } from "../api";
import { formatBytes } from "../bbox";
import { isGeoJSON } from "../preview";
import type { SavedFile } from "../types";

interface Props {
  files: SavedFile[];
  previewing?: string;
  onPreview(name: string): void;
  onValidate(name: string): void;
  onDelete(name: string): void;
  onRefresh(): void;
}

export function FilesPanel({ files, previewing, onPreview, onValidate, onDelete, onRefresh }: Props) {
  // Deleting is permanent, so it takes a second click on a named confirmation.
  const [confirming, setConfirming] = useState<string>();
  return (
    <div className="card">
      <h2>
        Saved files <button type="button" className="link" onClick={onRefresh}>refresh</button>
      </h2>
      {files.length === 0 ? (
        <p className="muted">Nothing downloaded yet.</p>
      ) : (
        <ul className="files">
          {files.map((file) => (
            <li key={file.name} className={file.name === previewing ? "current" : ""}>
              <div>
                <strong>{file.name}</strong>
                <span className="muted"> {formatBytes(file.size)} · {new Date(file.modified).toLocaleString()}</span>
              </div>
              <div className="row">
                <button type="button" onClick={() => onPreview(file.name)}>Preview</button>
                {isGeoJSON(file.name) && <button type="button" onClick={() => onValidate(file.name)}>Validate</button>}
                <a className="button" href={fileUrl(file.name, true)}>Download</a>
                {confirming === file.name ? (
                  <>
                    <button type="button" className="danger" onClick={() => { setConfirming(undefined); onDelete(file.name); }}>
                      Delete for good
                    </button>
                    <button type="button" onClick={() => setConfirming(undefined)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(file.name)}>Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
