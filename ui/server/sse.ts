const encoder = new TextEncoder();

export type Send = (event: string, data: unknown) => void;

// Streams server-sent events produced by `run`. A closed tab cancels the stream: `run` keeps going to the end,
// but nothing is written to the dead stream (writing to a closed controller throws, and from a timer that would crash the server).
// The periodic comment line keeps idle connections open while a slow download is quiet.
export function eventStream(run: (send: Send) => Promise<void>, heartbeatMs: number): Response {
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      ping = setInterval(() => write(": ping\n\n"), heartbeatMs);
      try {
        await run((event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } finally {
        clearInterval(ping);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
