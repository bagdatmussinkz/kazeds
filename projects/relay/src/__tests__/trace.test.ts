/**
 * Trace routes — distributed tracing ingest/read/clear
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { traceRoutes } from "../routes/trace";
import { TraceStore } from "../services/trace-store";
import { TRACE_MAX_EVENTS } from "@kazeds/shared";

let app: ReturnType<typeof Fastify>;
let store: TraceStore;

beforeAll(async () => {
  app = Fastify();
  store = new TraceStore();
  app.decorate("traceStore", store);
  await app.register(traceRoutes, { prefix: "/v1" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  store.clear();
});

const event = (over: Record<string, unknown> = {}) => ({
  session_id: "s-1",
  source: "web-app",
  level: "info",
  msg: "test event",
  data: { payload: "abc" },
  ts: new Date().toISOString(),
  ...over,
});

describe("POST /v1/trace", () => {
  it("accepts a single event", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trace", payload: event() });
    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(1);
    expect(store.size).toBe(1);
  });

  it("accepts a batch of events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/trace",
      payload: [event(), event({ msg: "second" }), event({ level: "error" })],
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(3);
  });

  it("rejects unknown source", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/trace",
      payload: event({ source: "hacker" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing msg", async () => {
    const { msg: _msg, ...rest } = event();
    const res = await app.inject({ method: "POST", url: "/v1/trace", payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it("preserves full data payload", async () => {
    const big = { cms: "MIIG...", nested: { challenge: "abc", arr: [1, 2, 3] } };
    await app.inject({ method: "POST", url: "/v1/trace", payload: event({ data: big }) });
    const events = store.list();
    expect(events[0].data).toEqual(big);
    expect(events[0].received_at).toBeDefined();
  });
});

describe("GET /v1/trace", () => {
  it("returns events filtered by session_id", async () => {
    store.add(event() as any);
    store.add(event({ session_id: "s-2", msg: "other" }) as any);

    const res = await app.inject({ method: "GET", url: "/v1/trace?session_id=s-2" });
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.events[0].msg).toBe("other");
  });

  it("returns events filtered by source", async () => {
    store.add(event() as any);
    store.add(event({ source: "relay", msg: "from relay" }) as any);

    const res = await app.inject({ method: "GET", url: "/v1/trace?source=relay" });
    expect(res.json().count).toBe(1);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 10; i++) store.add(event({ msg: `e${i}` }) as any);
    const res = await app.inject({ method: "GET", url: "/v1/trace?limit=3" });
    const body = res.json();
    expect(body.count).toBe(3);
    // last 3 events
    expect(body.events[2].msg).toBe("e9");
  });
});

describe("DELETE /v1/trace", () => {
  it("clears the buffer", async () => {
    store.add(event() as any);
    const res = await app.inject({ method: "DELETE", url: "/v1/trace" });
    expect(res.statusCode).toBe(200);
    expect(store.size).toBe(0);
  });
});

describe("TraceStore ring buffer", () => {
  it("caps at TRACE_MAX_EVENTS", () => {
    for (let i = 0; i < TRACE_MAX_EVENTS + 50; i++) {
      store.add(event({ msg: `e${i}` }) as any);
    }
    expect(store.size).toBe(TRACE_MAX_EVENTS);
    // oldest dropped, newest kept
    const events = store.list({ limit: TRACE_MAX_EVENTS });
    expect(events[events.length - 1].msg).toBe(`e${TRACE_MAX_EVENTS + 49}`);
  });
});
