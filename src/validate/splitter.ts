export class ScanError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at character ${offset})`);
    this.name = "ScanError";
  }
}

export interface SplitHandlers {
  // A top-level member other than the "features" array, already parsed (type, attribution, bbox...).
  member(key: string, value: unknown): void;
  // The raw text of one element of the "features" array. Parsing it is the caller's job: a broken element is not fatal.
  element(text: string, index: number): void;
}

const ROOT = 0; // before the opening {
const KEY = 1; // expecting a member name or }
const IN_KEY = 2;
const COLON = 3;
const VALUE = 4; // expecting a member value
const IN_VALUE = 5; // inside a string or a container value
const SCALAR = 6; // inside a number, true, false or null
const AFTER = 7; // expecting , or }
const ELEMENTS = 8; // inside the "features" array
const DONE = 9;

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

// Incremental splitter for {"...": ..., "features": [ ... ], ...}. It only counts brackets and tracks string state,
// so features are cut out as text and handed over one at a time; memory stays proportional to the largest feature.
export class FeatureSplitter {
  private state = ROOT;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private key = "";
  private pieces: string[] = [];
  private index = 0;
  private consumed = 0;
  private sawFeatures = false;

  constructor(private readonly on: SplitHandlers) {}

  /** True once the "features" array has started: from then on the caller no longer needs to keep the text. */
  get inFeatures(): boolean {
    return this.sawFeatures;
  }

  push(chunk: string): void {
    const n = chunk.length;
    // where the token being captured starts in this chunk (0 when it began in an earlier chunk); -1 when none
    let from =
      this.state === IN_KEY || this.state === IN_VALUE || this.state === SCALAR || this.state === ELEMENTS ? 0 : -1;

    for (let i = 0; i < n; i++) {
      const c = chunk.charCodeAt(i);

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === 92) this.escaped = true;
        else if (c === 34) {
          this.inString = false;
          if (this.state === IN_KEY) {
            this.key = this.parse(this.take(chunk, from, i + 1), i) as string;
            this.state = COLON;
            from = -1;
          } else if (this.state === IN_VALUE && this.depth === 1) {
            this.on.member(this.key, this.parse(this.take(chunk, from, i + 1), i));
            this.state = AFTER;
            from = -1;
          }
        }
        continue;
      }

      if (this.state === SCALAR && (isSpace(c) || c === 44 || c === 125)) {
        this.on.member(this.key, this.parse(this.take(chunk, from, i), i));
        this.state = AFTER;
        from = -1;
      }

      switch (c) {
        case 34: // "
          this.inString = true;
          if (this.state === KEY) {
            this.state = IN_KEY;
            from = i;
          } else if (this.state === VALUE) {
            this.state = IN_VALUE;
            from = i;
          } else if (this.state !== IN_VALUE && this.state !== ELEMENTS) {
            throw this.error("unexpected string", i);
          }
          break;

        case 123: // {
        case 91: // [
          this.depth++;
          if (this.state === ROOT) {
            if (c !== 123) throw this.error("expected a GeoJSON object", i);
            this.state = KEY;
          } else if (this.state === VALUE) {
            if (c === 91 && this.key === "features") {
              this.state = ELEMENTS;
              this.sawFeatures = true;
              from = i + 1;
            } else {
              this.state = IN_VALUE;
              from = i;
            }
          } else if (this.state !== IN_VALUE && this.state !== ELEMENTS) {
            throw this.error("unexpected bracket", i);
          }
          break;

        case 125: // }
        case 93: // ]
          this.depth--;
          if (this.state === ELEMENTS && this.depth === 1) {
            if (c !== 93) throw this.error("mismatched brackets in the features array", i);
            this.endElement(chunk, from, i, true);
            this.state = AFTER;
            from = -1;
          } else if (this.state === IN_VALUE && this.depth === 1) {
            this.on.member(this.key, this.parse(this.take(chunk, from, i + 1), i));
            this.state = AFTER;
            from = -1;
          } else if (this.state === KEY || this.state === AFTER) {
            if (c !== 125 || this.depth !== 0) throw this.error("unexpected closing bracket", i);
            this.state = DONE;
          } else if (this.state !== IN_VALUE && this.state !== ELEMENTS) {
            throw this.error("unexpected closing bracket", i);
          }
          break;

        case 44: // ,
          if (this.state === ELEMENTS && this.depth === 2) {
            this.endElement(chunk, from, i, false);
            from = i + 1;
          } else if (this.state === AFTER) {
            this.state = KEY;
          } else if (this.state !== IN_VALUE && this.state !== ELEMENTS) {
            throw this.error("unexpected comma", i);
          }
          break;

        case 58: // :
          if (this.state === COLON) this.state = VALUE;
          else if (this.state !== IN_VALUE && this.state !== ELEMENTS) throw this.error("unexpected colon", i);
          break;

        default:
          if (isSpace(c)) break;
          if (this.state === VALUE) {
            this.state = SCALAR;
            from = i;
          } else if (this.state !== IN_VALUE && this.state !== ELEMENTS && this.state !== SCALAR) {
            throw this.error(`unexpected character "${chunk[i]}"`, i);
          }
      }
    }

    if (from >= 0) this.pieces.push(chunk.slice(from));
    this.consumed += n;
  }

  /** Call after the last chunk; throws if the input stopped in the middle of the document. */
  end(): void {
    if (this.state !== DONE) {
      throw new ScanError(this.state === ROOT ? "empty input" : "unexpected end of input", this.consumed);
    }
  }

  private take(chunk: string, from: number, to: number): string {
    const text = this.pieces.length ? this.pieces.join("") + chunk.slice(from, to) : chunk.slice(from, to);
    this.pieces = [];
    return text;
  }

  private parse(text: string, at: number): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw this.error(`invalid JSON: ${(error as Error).message}`, at);
    }
  }

  private endElement(chunk: string, from: number, to: number, last: boolean): void {
    const text = this.take(chunk, from, to);
    if (last && this.index === 0 && text.trim() === "") return; // an empty array
    this.on.element(text, this.index++);
  }

  private error(message: string, at: number): ScanError {
    return new ScanError(message, this.consumed + at);
  }
}
