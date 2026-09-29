// Starts pulling `source` immediately and buffers at most `limit` items ahead of the consumer.
export function prefetch<T>(source: AsyncIterable<T>, limit: number): AsyncGenerator<T> & { close(): Promise<void> } {
  const queue: T[] = [];
  let finished = false;
  let stopped = false;
  let failure: unknown;
  let hasFailure = false;
  let wakeConsumer = () => {};
  let wakeProducer = () => {};

  const pump = (async () => {
    try {
      for await (const item of source) {
        if (stopped) return;
        queue.push(item);
        wakeConsumer();
        while (queue.length >= limit && !stopped) await new Promise<void>((r) => (wakeProducer = r));
        if (stopped) return;
      }
    } catch (error) {
      failure = error;
      hasFailure = true;
    } finally {
      finished = true;
      wakeConsumer();
    }
  })();

  // return() on a generator that never started skips its finally, so callers need an explicit close.
  const close = async () => {
    stopped = true;
    queue.length = 0;
    wakeProducer();
    await pump;
  };

  const iterator = (async function* () {
    try {
      while (true) {
        while (queue.length === 0 && !finished) await new Promise<void>((r) => (wakeConsumer = r));
        if (queue.length > 0) {
          yield queue.shift()!;
          wakeProducer();
        } else {
          if (hasFailure) throw failure;
          return;
        }
      }
    } finally {
      await close();
    }
  })();
  return Object.assign(iterator, { close });
}
