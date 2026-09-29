import { useCallback, useEffect, useState } from "react";
import { listFiles } from "../api";
import type { SavedFile } from "../types";

export function useFiles(onError: (message: string) => void) {
  const [files, setFiles] = useState<SavedFile[]>([]);

  const refresh = useCallback(() => {
    listFiles()
      .then(setFiles)
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
  }, [onError]);

  useEffect(refresh, [refresh]);

  return { files, refresh };
}
