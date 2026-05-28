import { Nova, type Context, type ListenResult } from "@novajs/core";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRateLimitStore, rateLimit, type RateLimitStore } from "./rate-limit.js";

let running: ListenResult | undefined;

async function start(app: Nova): Promise<ListenResult> {
  const result = await app.listen(0);
  running = result;
  return result;
}

afterEach(async () => {
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
});

describe("rateLimit()", () => {
  it("allows requests up to `max` and rejects the next one with 429", async () => {
    const app = new Nova();
    await app.register(rateLimit({ max: 2, windowMs: 60_000 }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const r1 = await fetch(`http://127.0.0.1:${port}/`);
    const r2 = await fetch(`http://127.0.0.1:${port}/`);
    const r3 = await fetch(`http://127.0.0.1:${port}/`);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(await r3.json()).toEqual({ error: "Too Many Requests" });
  });

  it("emits RateLimit-* headers on every response", async () => {
    const app = new Nova();
    await app.register(rateLimit({ max: 3, windowMs: 60_000 }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const r1 = await fetch(`http://127.0.0.1:${port}/`);
    expect(r1.headers.get("ratelimit-limit")).toBe("3");
    expect(r1.headers.get("ratelimit-remaining")).toBe("2");
    expect(r1.headers.get("ratelimit-reset")).toMatch(/^\d+$/);

    const r2 = await fetch(`http://127.0.0.1:${port}/`);
    expect(r2.headers.get("ratelimit-remaining")).toBe("1");

    const r3 = await fetch(`http://127.0.0.1:${port}/`);
    expect(r3.headers.get("ratelimit-remaining")).toBe("0");
  });

  it("adds Retry-After when rejecting with 429", async () => {
    const app = new Nova();
    await app.register(rateLimit({ max: 1, windowMs: 60_000 }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);
    const rejected = await fetch(`http://127.0.0.1:${port}/`);

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("resets the counter once the window elapses", async () => {
    const app = new Nova();
    await app.register(rateLimit({ max: 1, windowMs: 100 }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const r1 = await fetch(`http://127.0.0.1:${port}/`);
    const r2 = await fetch(`http://127.0.0.1:${port}/`);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);

    await new Promise((r) => setTimeout(r, 120));

    const r3 = await fetch(`http://127.0.0.1:${port}/`);
    expect(r3.status).toBe(200);
  });

  it("uses a custom keyGenerator", async () => {
    const seen: string[] = [];
    const app = new Nova();
    await app.register(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        keyGenerator: (ctx) => {
          const k = (ctx.raw.req.headers["x-tenant"] as string | undefined) ?? "anon";
          seen.push(k);
          return k;
        },
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    // Two different tenants → both succeed (independent counters).
    const a1 = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-tenant": "alpha" } });
    const b1 = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-tenant": "beta" } });
    expect(a1.status).toBe(200);
    expect(b1.status).toBe(200);

    // Second alpha hits the limit, second beta also does.
    const a2 = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-tenant": "alpha" } });
    expect(a2.status).toBe(429);

    expect(seen.filter((k) => k === "alpha")).toHaveLength(2);
    expect(seen.filter((k) => k === "beta")).toHaveLength(1);
  });

  it("skips requests for which the skip() returns true", async () => {
    const app = new Nova();
    await app.register(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        skip: (ctx) => ctx.raw.req.headers["x-admin"] === "yes",
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    await fetch(`http://127.0.0.1:${port}/`);
    // Without skip, this would 429. With x-admin, it bypasses.
    const admin1 = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-admin": "yes" } });
    const admin2 = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-admin": "yes" } });

    expect(admin1.status).toBe(200);
    expect(admin2.status).toBe(200);
  });

  it("supports an async skip()", async () => {
    const app = new Nova();
    await app.register(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        skip: async (ctx) => {
          await new Promise((r) => setTimeout(r, 5));
          return ctx.raw.req.headers["x-admin"] === "yes";
        },
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-admin": "yes" } });
    expect(res.status).toBe(200);
  });

  it("uses a custom message and status code on rejection", async () => {
    const app = new Nova();
    await app.register(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        message: "Slow down",
        status: 503,
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    // First request fits within the limit; second is rejected.
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    expect(ok.status).toBe(200);

    const rejected = await fetch(`http://127.0.0.1:${port}/`);
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: "Slow down" });
  });

  it("invokes onLimit when a request is rejected", async () => {
    const seen: Context[] = [];
    const app = new Nova();
    await app.register(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        onLimit: (ctx) => {
          seen.push(ctx);
        },
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);
    await fetch(`http://127.0.0.1:${port}/`); // rejected

    // Give the fire-and-forget hook a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
  });

  it("does not emit headers when headers: false", async () => {
    const app = new Nova();
    await app.register(rateLimit({ max: 1, windowMs: 60_000, headers: false }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.headers.get("ratelimit-limit")).toBeNull();
    expect(res.headers.get("ratelimit-remaining")).toBeNull();
    expect(res.headers.get("ratelimit-reset")).toBeNull();
  });

  it("accepts a custom store implementation", async () => {
    const calls: { key: string; windowMs: number }[] = [];
    const fakeStore: RateLimitStore = {
      increment(key, windowMs) {
        calls.push({ key, windowMs });
        return { count: 1, resetAt: Date.now() + windowMs };
      },
    };

    const app = new Nova();
    await app.register(rateLimit({ max: 5, windowMs: 1_000, store: fakeStore }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.windowMs).toBe(1_000);
  });

  it("rejects invalid configuration at register time", () => {
    expect(() => rateLimit({ max: 0, windowMs: 1_000 })).toThrowError(/`max` must be a positive/);
    expect(() => rateLimit({ max: 5, windowMs: 0 })).toThrowError(/`windowMs` must be a positive/);
    expect(() => rateLimit({ max: -1, windowMs: 1_000 })).toThrowError(/`max` must be a positive/);
  });
});

describe("InMemoryRateLimitStore", () => {
  it("rejects non-positive or non-integer maxKeys", () => {
    expect(() => new InMemoryRateLimitStore({ maxKeys: 0 })).toThrowError(
      /maxKeys.*positive integer/,
    );
    expect(() => new InMemoryRateLimitStore({ maxKeys: -1 })).toThrowError(
      /maxKeys.*positive integer/,
    );
    expect(() => new InMemoryRateLimitStore({ maxKeys: 1.5 })).toThrowError(
      /maxKeys.*positive integer/,
    );
  });

  it("caps the number of tracked keys and evicts the oldest on overflow", () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 3 });

    // Fill to capacity.
    store.increment("a", 60_000);
    store.increment("b", 60_000);
    store.increment("c", 60_000);
    expect(store.size).toBe(3);

    // Overflow: "a" is the oldest insertion, so it gets evicted.
    store.increment("d", 60_000);
    expect(store.size).toBe(3);

    // "a" should now be a fresh window (count=1), not a stale 2 from before.
    const aAgain = store.increment("a", 60_000);
    expect(aAgain.count).toBe(1);
    expect(store.size).toBe(3);

    // The eviction this triggered should have dropped the new oldest, "b".
    const bAgain = store.increment("b", 60_000);
    expect(bAgain.count).toBe(1);
  });

  it("does not evict when an existing key is hit again (no extra slot used)", () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 2 });

    store.increment("a", 60_000);
    store.increment("b", 60_000);
    expect(store.size).toBe(2);

    // Repeated hits to existing keys must not trigger eviction.
    for (let i = 0; i < 50; i++) {
      const result = store.increment("a", 60_000);
      expect(result.count).toBe(i + 2);
    }
    expect(store.size).toBe(2);
  });

  it("uses 10_000 as the default cap when maxKeys is omitted", () => {
    const store = new InMemoryRateLimitStore();
    // Just one beyond the documented default to confirm eviction kicks in
    // without allocating 10k+ entries unnecessarily slowly.
    for (let i = 0; i < 10_001; i++) {
      store.increment(`k${i}`, 60_000);
    }
    expect(store.size).toBe(10_000);
  });

  it("integrates cleanly when used as the `store` option of rateLimit()", async () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 5 });
    const app = new Nova();
    await app.register(rateLimit({ max: 1, windowMs: 60_000, store }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const r1 = await fetch(`http://127.0.0.1:${port}/`);
    const r2 = await fetch(`http://127.0.0.1:${port}/`);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);
    expect(store.size).toBe(1);
  });
});
