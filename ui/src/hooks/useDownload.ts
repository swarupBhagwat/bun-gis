import { useCallback, useState } from "react";
import type { DownloadBody } from "../../server/api";
import { startDownload } from "../api";
import type { DownloadOutcome, LogLine } from "../types";

interface Callbacks {
  /** Runs when a download ends, successfully or not (e.g. to refresh the file list). */
  onSettled(): void;
  /** Runs after a successful download with the saved file name. */
  onFinished(filename: string): void;
}

export function useDownload({ onSettled, onFinished }: Callbacks) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [outcome, setOutcome] = useState<DownloadOutcome>();

  const start = useCallback(
    async (body: DownloadBody) => {
      const add = (line: LogLine) => setLines((current) => [...current, line]);
      setRunning(true);
      setLines([]);
      setOutcome(undefined);
      let finished: DownloadOutcome | undefined;
      let ended = false;
      try {
        await startDownload(body, ({ event, data }) => {
          if (event === "log") add(data as LogLine);
          if (event === "result") {
            finished = data as DownloadOutcome;
            setOutcome(finished);
            ended = true;
          }
          if (event === "error") {
            const failure = data as { message: string; hint?: string; stack?: string };
            add({ level: "error", text: failure.message, hint: [failure.hint, failure.stack].filter(Boolean).join("\n\n") || undefined });
            ended = true;
          }
        });
        if (!ended) add({ level: "error", text: "The connection closed before the download finished." });
      } catch (error) {
        add({ level: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setRunning(false);
        onSettled();
      }
      if (finished) onFinished(finished.filename);
    },
    [onSettled, onFinished],
  );

  return { running, lines, outcome, start };
}
