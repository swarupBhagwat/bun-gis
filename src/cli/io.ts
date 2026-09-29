export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const defaultIo: Io = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};
