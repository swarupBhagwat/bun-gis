import { describe, expect, test } from "bun:test";
import { eventStream } from "../server/sse";
import { parseSSE } from "../src/sse";

describe("eventStream", () => {
  test("delivers events in order and then closes", async () => {
    const response = eventStream(async (send) => {
      send("log", { n: 1 });
      send("result", { n: 2 });
    }, 1000);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(parseSSE(await response.text()).events).toEqual([
      { event: "log", data: { n: 1 } },
      { event: "result", data: { n: 2 } },
    ]);
  });

  test("keeps the connection alive with comment lines while quiet", async () => {
    const response = eventStream(() => Bun.sleep(60), 10);
    expect(await response.text()).toContain(": ping");
  });

  test("after the client cancels, run continues and its later sends are ignored", async () => {
    let sendLate!: () => void;
    let finished = false;
    const response = eventStream(async (send) => {
      await new Promise<void>((resolve) => (sendLate = () => { send("log", { late: true }); resolve(); }));
      finished = true;
    }, 5);
    await response.body!.cancel();
    await Bun.sleep(30); // heartbeats keep firing against the cancelled stream
    sendLate();
    await Bun.sleep(10);
    expect(finished).toBe(true);
  });

  test("a run that throws still ends the stream", async () => {
    const response = eventStream(async () => {
      throw new Error("boom");
    }, 1000);
    await response.text().catch(() => {});
  });
});
