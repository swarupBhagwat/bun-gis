import { useRef, useState } from "react";
import { validate, validateUpload } from "../api";
import type { ValidationOutcome } from "../types";

interface Target {
  label: string;
  file?: string;
  upload?: File;
}

// Validates a saved file (by name) or an uploaded one, and re-runs the last target when strict mode is toggled.
export function useValidation() {
  const [strict, setStrictState] = useState(false);
  const [outcome, setOutcome] = useState<ValidationOutcome>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const last = useRef<Target | undefined>(undefined);

  const run = async (target: Target, strictMode: boolean) => {
    last.current = target;
    setBusy(true);
    setError(undefined);
    try {
      const { report, failed } = target.upload
        ? await validateUpload(target.upload, strictMode)
        : await validate({ file: target.file, strict: strictMode });
      setOutcome({ label: target.label, report, failed });
    } catch (failure) {
      setOutcome(undefined);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return {
    strict,
    outcome,
    busy,
    error,
    validateSaved: (name: string) => run({ label: name, file: name }, strict),
    validateUpload: (file: File) => run({ label: file.name, upload: file }, strict),
    setStrict: (value: boolean) => {
      setStrictState(value);
      if (last.current) run(last.current, value);
    },
  };
}
