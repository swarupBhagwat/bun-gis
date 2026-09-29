import { formatBytes } from "../bbox";
import type { ValidationOutcome } from "../types";

const ICON = { pass: "✓", warn: "⚠", fail: "✗" } as const;

export function ReportView({ outcome, strict }: { outcome: ValidationOutcome; strict: boolean }) {
  const { report, failed } = outcome;
  const types = Object.entries(report.geometryTypes).map(([type, n]) => `${type} ${n}`).join(", ");
  const verdict = failed ? "Invalid" : report.warned ? "Valid, with warnings" : "Valid";
  return (
    <div className="report">
      <p className="muted">
        {outcome.label} · {formatBytes(report.bytes)} · {report.featureCount.toLocaleString("en-US")} features
        {types && ` (${types})`}
      </p>
      <ul>
        {report.checks.map((check) => (
          <li key={check.name} className={check.status}>
            <span aria-hidden>{ICON[check.status]}</span> <strong>{check.name}</strong>: {check.detail}
            {check.examples.length > 0 && (
              <ul className="examples">
                {check.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className={`verdict ${failed ? "fail" : report.warned ? "warn" : "pass"}`}>
        {failed ? "✗" : "✓"} {verdict}
        {strict && report.warned && " (strict: warnings fail)"}
      </p>
    </div>
  );
}
