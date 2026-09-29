import { formatBytes } from "../format";
import { isFailure } from "./check";
import type { Report } from "./check";

const ICON = { pass: "✓", warn: "⚠", fail: "✗" } as const;

export function formatReport(file: string, report: Report, strict: boolean): string {
  const types = Object.entries(report.geometryTypes)
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  const lines = [
    `${file} (${formatBytes(report.bytes)})`,
    `Features: ${report.featureCount.toLocaleString("en-US")}${types ? `  (${types})` : ""}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`${ICON[check.status]} ${check.name}: ${check.detail}`);
    for (const example of check.examples) lines.push(`    ${example}`);
  }
  lines.push("", isFailure(report, strict) ? "✗ Invalid" : report.warned ? "✓ Valid, with warnings" : "✓ Valid");
  return lines.join("\n");
}
