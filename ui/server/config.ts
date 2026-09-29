import { resolve } from "node:path";

// Where downloads are saved. BUNGIS_UI_OUTPUT lets tests (or a second server) use their own folder instead of sharing the real one.
export function outputDirFrom(env: Record<string, string | undefined>, fallback: string): string {
  const configured = env.BUNGIS_UI_OUTPUT?.trim();
  return configured ? resolve(configured) : fallback;
}
