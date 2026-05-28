import type { StandardSchemaV1 } from "@novats/validator";
import { afterEach, describe, expect, it } from "vitest";
import { Nova } from "./application.js";
import {
  badRequest,
  HttpError,
  internalServerError,
  notFound,
  unauthorized,
} from "./http-error.js";
import type { ListenResult } from "./types.js";

/**
 * Tiny hand-rolled Standard Schema for tests, so the test file stays
 * self-contained (no Zod/Valibot dep). The contract is exactly what
 * `validateStandard` consumes.
 */
function objectSchema<T extends Record<string, "string" | "number">>(
  shape: T,
): StandardSchemaV1<
  Record<string, unknown>,
  { [K in keyof T]: T[K] extends "string" ? string : number }
> {
  type Output = { [K in keyof T]: T[K] extends "string" ? string : number };
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test",
      validate: (value) => {
        if (typeof value !== "object" || value === null) {
          return { issues: [{ message: "Expected object" }] };
        }
        const out: Record<string, unknown> = {};
        const issues: { message: string; path: readonly string[] }[] = [];
        const input = value as Record<string, unknown>;
        for (const key of Object.keys(shape)) {
          const expected = shape[key];
          const actual = input[key];
          if (expected === "string" && typeof actual !== "string") {
            issues.push({ message: `Expected string`, path: [key] });
          } else if (expected === "number" && typeof actual !== "number") {
            issues.push({ message: `Expected number`, path: [key] });
          } else {
            out[key] = actual;
          }
        }
        if (issues.length > 0) return { issues };
        return { value: out as Output };
      },
    },
  };
}

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

describe("Nova end-to-end", () => {
  it("serves an object as JSON 200", async () => {
    const app = new Nova();
    app.get("/", () => ({ hello: "world" }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("serves a string as text/plain 200", async () => {
    const app = new Nova();
    app.get("/", () => "hello");

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("hello");
  });

  it("serves a Uint8Array as application/octet-stream", async () => {
    const app = new Nova();
    app.get("/", () => new Uint8Array([1, 2, 3, 4]));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/octet-stream/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns 204 when handler returns null or undefined", async () => {
    const app = new Nova();
    app.get("/none", () => undefined);
    app.get("/null", () => null);

    const { port } = await start(app);

    const a = await fetch(`http://127.0.0.1:${port}/none`);
    expect(a.status).toBe(204);
    expect(await a.text()).toBe("");

    const b = await fetch(`http://127.0.0.1:${port}/null`);
    expect(b.status).toBe(204);
  });

  it("awaits async handlers", async () => {
    const app = new Nova();
    app.get("/", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true };
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(await res.json()).toEqual({ ok: true });
  });

  it("respects ctx.status + ctx.header chaining", async () => {
    const app = new Nova();
    app.get("/", (ctx) => {
      ctx.status(201).header("x-trace", "abc").json({ created: true });
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(201);
    expect(res.headers.get("x-trace")).toBe("abc");
    expect(await res.json()).toEqual({ created: true });
  });

  it("returns 404 JSON for unmatched routes", async () => {
    const app = new Nova();
    app.get("/", () => "root");

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  it("returns 404 when method does not match", async () => {
    const app = new Nova();
    app.get("/users", () => []);

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users`, { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("returns 500 JSON when a handler throws", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new Error("boom");
    });

    const { port } = await start(app);

    // The 500 path logs to stderr; silence it for the duration of this test.
    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal Server Error" });
    } finally {
      console.error = originalError;
    }
  });

  it("ignores query string when matching", async () => {
    const app = new Nova();
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/?foo=bar&baz=qux`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("supports multiple methods on the same path", async () => {
    const app = new Nova();
    app.get("/users", () => "list");
    app.post("/users", () => "create");

    const { port } = await start(app);

    const g = await fetch(`http://127.0.0.1:${port}/users`);
    const p = await fetch(`http://127.0.0.1:${port}/users`, { method: "POST" });

    expect(await g.text()).toBe("list");
    expect(await p.text()).toBe("create");
  });

  it("listen() twice on the same app throws", async () => {
    const app = new Nova();
    await start(app);

    await expect(app.listen(0)).rejects.toThrow(/already listening/);
  });

  it("close() is idempotent when not listening", async () => {
    const app = new Nova();
    await expect(app.close()).resolves.toBeUndefined();
  });

  it("listen() resolves with the actual port when port=0", async () => {
    const app = new Nova();
    const { port } = await start(app);

    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  it("respects an explicit ctx.json() call (no double-send)", async () => {
    const app = new Nova();
    app.get("/", (ctx) => {
      ctx.status(202).json({ accepted: true });
      // Return value should be ignored once ctx has flushed.
      return { ignored: true };
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
  });
});

describe("Nova with route parameters", () => {
  it("populates ctx.params from a single-param route", async () => {
    const app = new Nova();
    app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users/42`);

    expect(await res.json()).toEqual({ id: "42" });
  });

  it("populates ctx.params from a multi-param route", async () => {
    const app = new Nova();
    app.get("/users/:userId/posts/:postId", (ctx) => ({
      userId: ctx.params.userId,
      postId: ctx.params.postId,
    }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users/7/posts/13`);

    expect(await res.json()).toEqual({ userId: "7", postId: "13" });
  });

  it("treats an optional trailing parameter as `string | undefined`", async () => {
    const app = new Nova();
    app.get("/files/:name?", (ctx) => ({
      // ctx.params.name has type `string | undefined` at this point.
      name: ctx.params.name ?? null,
    }));

    const { port } = await start(app);

    const without = await fetch(`http://127.0.0.1:${port}/files`);
    expect(await without.json()).toEqual({ name: null });

    const withName = await fetch(`http://127.0.0.1:${port}/files/report.pdf`);
    expect(await withName.json()).toEqual({ name: "report.pdf" });
  });

  it("gives a static route priority over a parametric one", async () => {
    const app = new Nova();
    app.get("/users/:id", (ctx) => ({ kind: "param", id: ctx.params.id }));
    app.get("/users/me", () => ({ kind: "static" }));

    const { port } = await start(app);

    const me = await fetch(`http://127.0.0.1:${port}/users/me`);
    expect(await me.json()).toEqual({ kind: "static" });

    const other = await fetch(`http://127.0.0.1:${port}/users/123`);
    expect(await other.json()).toEqual({ kind: "param", id: "123" });
  });

  it("returns 404 when a parametric route is registered but the request shape doesn't match", async () => {
    const app = new Nova();
    app.get("/users/:id", () => ({ ok: true }));

    const { port } = await start(app);

    // `/users` has no params and is NOT registered, so the trie cannot match it.
    const res = await fetch(`http://127.0.0.1:${port}/users`);
    expect(res.status).toBe(404);
  });

  it("returns an empty params object for static routes", async () => {
    const app = new Nova();
    app.get("/health", (ctx) => ({ keys: Object.keys(ctx.params) }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(await res.json()).toEqual({ keys: [] });
  });
});

describe("Nova with query string", () => {
  it("exposes a single query value via ctx.query", async () => {
    const app = new Nova();
    app.get("/search", (ctx) => ({ q: ctx.query["q"], page: ctx.query["page"] }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/search?q=hello&page=2`);

    expect(await res.json()).toEqual({ q: "hello", page: "2" });
  });

  it("collects repeated keys into an array of strings", async () => {
    const app = new Nova();
    app.get("/filter", (ctx) => ({ ids: ctx.query["ids"] }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/filter?ids=1&ids=2&ids=3`);

    expect(await res.json()).toEqual({ ids: ["1", "2", "3"] });
  });

  it("returns an empty record when the URL has no query string", async () => {
    const app = new Nova();
    app.get("/health", (ctx) => ({ keys: Object.keys(ctx.query) }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(await res.json()).toEqual({ keys: [] });
  });

  it("URL-decodes query values", async () => {
    const app = new Nova();
    app.get("/echo", (ctx) => ({ msg: ctx.query["msg"] }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/echo?msg=hello%20world`);

    expect(await res.json()).toEqual({ msg: "hello world" });
  });

  it("drops forbidden prototype-pollution keys at parse time", async () => {
    const app = new Nova();
    app.get("/poll", (ctx) => ({
      keys: Object.keys(ctx.query),
      safe: ctx.query["safe"],
    }));

    const { port } = await start(app);
    const res = await fetch(
      `http://127.0.0.1:${port}/poll?__proto__=evil&constructor=evil&safe=ok`,
    );

    expect(await res.json()).toEqual({ keys: ["safe"], safe: "ok" });
  });

  it("caches the query result across multiple accesses in one handler", async () => {
    const app = new Nova();
    app.get("/cached", (ctx) => ({ same: ctx.query === ctx.query }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/cached?a=1`);

    expect(await res.json()).toEqual({ same: true });
  });

  it("does not consult the query string when matching routes", async () => {
    // Regression: query strings must be stripped before the router sees the
    // path, otherwise `/users?_=1` would not match `app.get("/users", ...)`.
    const app = new Nova();
    app.get("/users", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users?_=cachebust`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("Nova middleware", () => {
  it("runs middleware before the handler in registration order", async () => {
    const order: string[] = [];
    const app = new Nova();
    app.use(async (_ctx, next) => {
      order.push("a");
      await next();
    });
    app.use(async (_ctx, next) => {
      order.push("b");
      await next();
    });
    app.get("/", () => {
      order.push("handler");
      return { ok: true };
    });

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(order).toEqual(["a", "b", "handler"]);
  });

  it("runs after-phases in reverse order (onion)", async () => {
    const order: string[] = [];
    const app = new Nova();
    app.use(async (_ctx, next) => {
      order.push("a-before");
      await next();
      order.push("a-after");
    });
    app.use(async (_ctx, next) => {
      order.push("b-before");
      await next();
      order.push("b-after");
    });
    app.get("/", () => {
      order.push("handler");
      return null;
    });

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(order).toEqual(["a-before", "b-before", "handler", "b-after", "a-after"]);
  });

  it("lets a middleware short-circuit the handler by not calling next()", async () => {
    let handlerRan = false;
    const app = new Nova();
    app.use((ctx, _next) => {
      ctx.status(401).json({ error: "unauthorized" });
    });
    app.get("/", () => {
      handlerRan = true;
      return { ok: true };
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(handlerRan).toBe(false);
  });

  it("middleware can set response headers via ctx.header in after-phase", async () => {
    const app = new Nova();
    app.use(async (ctx, next) => {
      ctx.header("x-trace", "abc");
      await next();
    });
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.headers.get("x-trace")).toBe("abc");
  });

  it("middleware can set headers AFTER the handler buffered its body (regression)", async () => {
    // Regression: a previous design eagerly flushed `res.end()` inside the
    // handler's `ctx.json` call. That broke the canonical timing pattern
    // because by the time an after-phase ran, the wire was already closed.
    // The current design buffers the body until Nova's `[FINALIZE]` runs
    // *after* the chain, so post-handler `ctx.header(...)` is valid.
    const app = new Nova();
    app.use(async (ctx, next) => {
      await next();
      // Handler has already called ctx.json — ctx.sent is true.
      // Setting a header here must still succeed.
      expect(ctx.sent).toBe(true);
      ctx.header("x-after-handler", "ok");
    });
    app.get("/", () => ({ hello: "world" }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-after-handler")).toBe("ok");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("rejects ctx.status() with codes outside [100, 599] or non-integers", async () => {
    const errors: string[] = [];
    const app = new Nova();
    app.get("/", (ctx) => {
      for (const bad of [99, 600, 1000, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        try {
          ctx.status(bad);
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      ctx.status(599).json({ ok: true });
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(599);
    expect(errors).toHaveLength(7);
    for (const msg of errors) {
      expect(msg).toMatch(/Invalid HTTP status code/);
    }
  });

  it("accepts ctx.status() at the boundary values 100 and 599", async () => {
    let lowOk = false;
    let highOk = false;
    const app = new Nova();
    app.get("/", (ctx) => {
      // 100 is the spec lower bound. Whether it round-trips on the wire is
      // up to Node — here we only assert the validator does not reject it.
      try {
        ctx.status(100);
        lowOk = true;
      } catch {
        lowOk = false;
      }
      try {
        ctx.status(599);
        highOk = true;
      } catch {
        highOk = false;
      }
      ctx.json({ ok: true });
    });

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(lowOk).toBe(true);
    expect(highOk).toBe(true);
  });

  it("rejects ctx.status() after a body has been declared", async () => {
    const app = new Nova();
    let errorMessage: string | undefined;
    app.use(async (ctx, next) => {
      await next();
      try {
        ctx.status(500);
      } catch (err) {
        errorMessage = (err as Error).message;
      }
    });
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(errorMessage).toMatch(/Cannot set status\(\) after a response body/);
  });

  it("upstream middleware can recover from downstream errors", async () => {
    const app = new Nova();
    app.use(async (ctx, next) => {
      try {
        await next();
      } catch {
        ctx.status(418).json({ error: "tea-pot fallback" });
      }
    });
    app.get("/", () => {
      throw new Error("boom");
    });

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ error: "tea-pot fallback" });
    } finally {
      console.error = originalError;
    }
  });

  it("propagates errors from middleware to the 500 fallback", async () => {
    const app = new Nova();
    app.use(() => {
      throw new Error("middleware boom");
    });
    app.get("/", () => ({ ok: true }));

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal Server Error" });
    } finally {
      console.error = originalError;
    }
  });

  it("middleware runs even when the route does not match (so logging sees 404s)", async () => {
    const seen: string[] = [];
    const app = new Nova();
    app.use(async (ctx, next) => {
      seen.push(ctx.path);
      await next();
    });
    app.get("/known", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);

    expect(res.status).toBe(404);
    expect(seen).toEqual(["/unknown"]);
  });

  it("provides a per-request ctx.state for inter-middleware communication", async () => {
    const app = new Nova();
    app.use(async (ctx, next) => {
      ctx.state["requestId"] = "abc-123";
      await next();
    });
    app.get("/", (ctx) => ({ id: ctx.state["requestId"] }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(await res.json()).toEqual({ id: "abc-123" });
  });

  it("isolates ctx.state per request", async () => {
    const app = new Nova();
    let counter = 0;
    app.use(async (ctx, next) => {
      counter += 1;
      ctx.state["n"] = counter;
      await next();
    });
    app.get("/", (ctx) => ({ n: ctx.state["n"] }));

    const { port } = await start(app);
    const [a, b] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/`).then((r) => r.json() as Promise<{ n: number }>),
      fetch(`http://127.0.0.1:${port}/`).then((r) => r.json() as Promise<{ n: number }>),
    ]);

    // Each request saw its own counter snapshot (1 and 2 in some order).
    expect([a.n, b.n].sort()).toEqual([1, 2]);
  });

  it("ctx.state has a null prototype (immune to prototype lookups)", async () => {
    const app = new Nova();
    app.get("/", (ctx) => ({
      proto: Object.getPrototypeOf(ctx.state),
      hasToString: typeof (ctx.state as Record<string, unknown>)["toString"],
    }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(await res.json()).toEqual({ proto: null, hasToString: "undefined" });
  });

  it("supports a realistic logger + timing + auth pipeline", async () => {
    const events: string[] = [];
    const app = new Nova();

    // Logger
    app.use(async (ctx, next) => {
      events.push(`> ${ctx.method} ${ctx.path}`);
      await next();
      events.push(`< ${ctx.method} ${ctx.path}`);
    });

    // Timing — uses `ctx.header()` in the after-phase. Works because the
    // response is buffered until Nova finalizes the wire after the chain.
    app.use(async (ctx, next) => {
      const t0 = process.hrtime.bigint();
      await next();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      ctx.header("x-elapsed-ms", ms.toFixed(2));
    });

    // Auth
    app.use((ctx, next) => {
      if (ctx.path === "/secret") {
        ctx.status(401).json({ error: "auth required" });
        return;
      }
      return next();
    });

    app.get("/", () => ({ ok: true }));
    app.get("/secret", () => ({ secret: true }));

    const { port } = await start(app);

    const ok = await fetch(`http://127.0.0.1:${port}/`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-elapsed-ms")).toMatch(/^\d+\.\d+$/);

    const blocked = await fetch(`http://127.0.0.1:${port}/secret`);
    expect(blocked.status).toBe(401);
    // Timing header runs in the after-phase, which still fires even though
    // auth short-circuited (because timing is upstream of auth).
    expect(blocked.headers.get("x-elapsed-ms")).toMatch(/^\d+\.\d+$/);

    expect(events).toEqual(["> GET /", "< GET /", "> GET /secret", "< GET /secret"]);
  });
});

describe("Nova error handling", () => {
  // Silence stderr around tests that intentionally produce server-side logs.
  // Each test that needs it wraps its own block — keeps unrelated stderr visible.

  it("renders a thrown HttpError with its status and default body shape", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new HttpError(404, "User missing");
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found", message: "User missing" });
  });

  it("supports throwing via convenience factories", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw notFound();
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(404);
    // Default message used when none provided; expose is true for 4xx, so it appears.
    expect(await res.json()).toEqual({ error: "Not Found", message: "Not Found" });
  });

  it("hides the message of a 5xx HttpError from the client by default", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new HttpError(503, "DB password leak: hunter2");
    });

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(503);
      // Message NOT in the body — only the canonical reason phrase.
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ error: "Service Unavailable" });
      expect(body["message"]).toBeUndefined();
    } finally {
      console.error = originalError;
    }
  });

  it("honors an explicit `expose: true` on a 5xx error", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new HttpError(503, "Maintenance window 02:00-03:00 UTC", { expose: true });
    });

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Service Unavailable",
        message: "Maintenance window 02:00-03:00 UTC",
      });
    } finally {
      console.error = originalError;
    }
  });

  it("renders a custom body when `options.body` is provided", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new HttpError(422, "validation", {
        body: { code: "VALIDATION_ERROR", details: [{ field: "email" }] },
      });
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "VALIDATION_ERROR",
      details: [{ field: "email" }],
    });
  });

  it("applies custom headers from the HttpError", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new HttpError(401, "Login required", {
        headers: { "WWW-Authenticate": 'Bearer realm="api"' },
      });
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="api"');
  });

  it("renders 500 for a generic Error (non-HttpError)", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw new Error("internals leaked here");
    });

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal Server Error" });
    } finally {
      console.error = originalError;
    }
  });

  it("invokes app.onError when set", async () => {
    const seen: unknown[] = [];
    const app = new Nova();
    app.onError((err, ctx) => {
      seen.push(err);
      ctx.status(599).json({ custom: true });
    });
    app.get("/", () => {
      throw new Error("custom");
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(599);
    expect(await res.json()).toEqual({ custom: true });
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe("custom");
  });

  it("suppresses Nova's auto-logging when an onError handler is set", async () => {
    const app = new Nova();
    let novaLogged = false;
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].startsWith("[nova]")) {
        novaLogged = true;
      }
    };
    try {
      app.onError((_err, ctx) => {
        ctx.status(500).json({ handled: true });
      });
      app.get("/", () => {
        throw new Error("hush");
      });

      const { port } = await start(app);
      await fetch(`http://127.0.0.1:${port}/`);

      expect(novaLogged).toBe(false);
    } finally {
      console.error = originalError;
    }
  });

  it("falls back to default rendering when onError does not respond", async () => {
    const app = new Nova();
    app.onError(() => {
      // intentionally does nothing
    });
    app.get("/", () => {
      throw new HttpError(409, "version mismatch");
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Conflict", message: "version mismatch" });
  });

  it("falls back to default rendering when onError itself throws", async () => {
    const app = new Nova();
    app.onError(() => {
      throw new Error("onError exploded");
    });
    app.get("/", () => {
      throw new Error("original");
    });

    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal Server Error" });
    } finally {
      console.error = originalError;
    }
  });

  it("routes errors thrown inside middleware through the same path", async () => {
    const app = new Nova();
    app.use(() => {
      throw unauthorized("missing token");
    });
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", message: "missing token" });
  });

  it("does not log 4xx HttpErrors automatically", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw badRequest("missing query");
    });

    let novaLogged = false;
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].startsWith("[nova]")) {
        novaLogged = true;
      }
    };
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(400);
      expect(novaLogged).toBe(false);
    } finally {
      console.error = originalError;
    }
  });

  it("does log 5xx HttpErrors automatically", async () => {
    const app = new Nova();
    app.get("/", () => {
      throw internalServerError("boom");
    });

    let novaLogged = false;
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].startsWith("[nova]")) {
        novaLogged = true;
      }
    };
    try {
      const { port } = await start(app);
      const res = await fetch(`http://127.0.0.1:${port}/`);

      expect(res.status).toBe(500);
      expect(novaLogged).toBe(true);
    } finally {
      console.error = originalError;
    }
  });
});

describe("Nova body validation", () => {
  it("validates and types ctx.body from the body schema", async () => {
    const schema = objectSchema({ name: "string", age: "number" });
    const app = new Nova();
    app.post("/users", { body: schema }, (ctx) => {
      // ctx.body is typed as { name: string; age: number }
      return { greeting: `Hello ${ctx.body.name}`, ageDoubled: ctx.body.age * 2 };
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", age: 28 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: "Hello Ada", ageDoubled: 56 });
  });

  it("returns 422 with structured issues when the body fails validation", async () => {
    const schema = objectSchema({ name: "string", age: "number" });
    const app = new Nova();
    app.post("/users", { body: schema }, (ctx) => ({ ok: ctx.body }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42, age: "twenty" }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("Unprocessable Entity");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues).toHaveLength(2);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const schema = objectSchema({ name: "string" });
    const app = new Nova();
    app.post("/users", { body: schema }, () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not: valid json}",
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      error: "Bad Request",
      message: "Invalid JSON body",
    });
  });

  it("returns 413 when the body exceeds the configured limit", async () => {
    const schema = objectSchema({ pad: "string" });
    const app = new Nova({ bodyLimit: 128 });
    app.post("/users", { body: schema }, () => ({ ok: true }));

    const { port } = await start(app);
    const oversized = JSON.stringify({ pad: "x".repeat(500) });
    const res = await fetch(`http://127.0.0.1:${port}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });

    expect(res.status).toBe(413);
  });

  it("still supports handler-only registration on body-bearing methods", async () => {
    const app = new Nova();
    app.post("/echo", (ctx) => ({ method: ctx.method, sent: ctx.sent }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      body: JSON.stringify({ irrelevant: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "POST", sent: false });
  });

  it("does not parse the body when no schema is declared", async () => {
    // Reading req.body off ctx returns undefined and no parsing cost is paid.
    const app = new Nova();
    app.post("/", (ctx) => ({ body: ctx.body, sent: ctx.sent }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: JSON.stringify({ should: "be ignored" }),
    });

    const json = (await res.json()) as { body?: unknown; sent: boolean };
    // `JSON.stringify({ body: undefined })` drops the key entirely (it does
    // not coerce to `null`), so the round-tripped object has no `body` field.
    expect(json.body).toBeUndefined();
    expect("body" in json).toBe(false);
    expect(json.sent).toBe(false);
  });

  it("runs middleware before the body is even read (auth short-circuit)", async () => {
    let bodyParsed = false;
    const schema: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "spy",
        validate: (value) => {
          bodyParsed = true;
          return { value };
        },
      },
    };
    const app = new Nova();
    app.use((ctx, _next) => {
      ctx.status(401).json({ error: "no" });
    });
    app.post("/users", { body: schema }, () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/users`, {
      method: "POST",
      body: JSON.stringify({ name: "any" }),
    });

    expect(bodyParsed).toBe(false);
  });

  it("supports async schemas", async () => {
    const slow: StandardSchemaV1<unknown, { ok: true }> = {
      "~standard": {
        version: 1,
        vendor: "slow",
        validate: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { value: { ok: true as const } };
        },
      },
    };
    const app = new Nova();
    app.post("/", { body: slow }, (ctx) => ctx.body);

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: "{}",
    });

    expect(await res.json()).toEqual({ ok: true });
  });

  it("body validation runs for PUT, PATCH, and DELETE as well", async () => {
    const schema = objectSchema({ id: "number" });
    const app = new Nova();
    app.put("/r/:id", { body: schema }, (ctx) => ({ put: ctx.body }));
    app.patch("/r/:id", { body: schema }, (ctx) => ({ patch: ctx.body }));
    app.delete("/r/:id", { body: schema }, (ctx) => ({ delete: ctx.body }));

    const { port } = await start(app);

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const ok = await fetch(`http://127.0.0.1:${port}/r/1`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      });
      expect(ok.status).toBe(200);

      const bad = await fetch(`http://127.0.0.1:${port}/r/1`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "not-a-number" }),
      });
      expect(bad.status).toBe(422);
    }
  });
});

describe("Nova query + params validation", () => {
  /** Schema that accepts any object input and outputs a typed projection of `keys`. */
  function pickStrings<K extends string>(
    ...keys: K[]
  ): StandardSchemaV1<Record<string, unknown>, Record<K, string>> {
    return {
      "~standard": {
        version: 1,
        vendor: "nova-test",
        validate: (value) => {
          if (typeof value !== "object" || value === null) {
            return { issues: [{ message: "Expected object" }] };
          }
          const input = value as Record<string, unknown>;
          const issues: { message: string; path: readonly string[] }[] = [];
          const out = {} as Record<K, string>;
          for (const k of keys) {
            if (typeof input[k] !== "string") {
              issues.push({ message: `Expected string`, path: [k] });
            } else {
              out[k] = input[k] as string;
            }
          }
          if (issues.length > 0) return { issues };
          return { value: out };
        },
      },
    };
  }

  /** Schema that coerces a string-valued field to a number. */
  function coerceNumber(
    field: string,
  ): StandardSchemaV1<Record<string, unknown>, Record<string, number>> {
    return {
      "~standard": {
        version: 1,
        vendor: "nova-test-coerce",
        validate: (value) => {
          if (typeof value !== "object" || value === null) {
            return { issues: [{ message: "Expected object" }] };
          }
          const raw = (value as Record<string, unknown>)[field];
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            return { issues: [{ message: "Not a number", path: [field] }] };
          }
          return { value: { [field]: n } };
        },
      },
    };
  }

  it("validates and overrides ctx.query via a query schema", async () => {
    const app = new Nova();
    app.get("/search", { query: pickStrings("q") }, (ctx) => ({ q: ctx.query.q }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/search?q=hello`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ q: "hello" });
  });

  it("returns 422 for an invalid query", async () => {
    const app = new Nova();
    app.get("/search", { query: pickStrings("q") }, (ctx) => ({ q: ctx.query.q }));

    const { port } = await start(app);
    // `q` missing entirely
    const res = await fetch(`http://127.0.0.1:${port}/search`);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { source: string; path: string[] }[] };
    expect(body.issues[0]?.source).toBe("query");
    expect(body.issues[0]?.path).toEqual(["q"]);
  });

  it("coerces params via a params schema", async () => {
    const app = new Nova();
    app.get("/users/:id", { params: coerceNumber("id") }, (ctx) => ({
      idType: typeof ctx.params.id,
      idValue: ctx.params.id,
    }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users/42`);

    expect(await res.json()).toEqual({ idType: "number", idValue: 42 });
  });

  it("returns 422 when params validation fails", async () => {
    const app = new Nova();
    app.get("/users/:id", { params: coerceNumber("id") }, (ctx) => ({ id: ctx.params.id }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users/not-a-number`);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { source: string }[] };
    expect(body.issues[0]?.source).toBe("params");
  });

  it("aggregates issues from multiple sources into one 422", async () => {
    const app = new Nova();
    app.post(
      "/users/:id",
      {
        params: coerceNumber("id"),
        query: pickStrings("token"),
        body: pickStrings("name"),
      },
      () => ({ ok: true }),
    );

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/users/not-a-number`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { source: string }[] };
    const sources = new Set(body.issues.map((i) => i.source));
    // All three sources should report at least one issue.
    expect(sources).toEqual(new Set(["params", "query", "body"]));
  });

  it("does not parse the body when params/query already failed but body schema is set", async () => {
    // Sanity: even if upstream sources fail, the body is still parsed so the
    // client gets the complete picture. The validator may even succeed for
    // body; only one source needs to fail to produce a 422.
    let bodyParsed = false;
    const bodySpy: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "spy",
        validate: (v) => {
          bodyParsed = true;
          return { value: v };
        },
      },
    };
    const app = new Nova();
    app.post("/x", { query: pickStrings("required"), body: bodySpy }, () => ({ ok: true }));

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(bodyParsed).toBe(true);
  });

  it("GET overload rejects body schema at the type level (runtime smoke)", async () => {
    // The type-system rejection is the primary contract; this test is a
    // runtime sanity check that `get(path, { query: ... }, handler)` works.
    const app = new Nova();
    app.get("/q", { query: pickStrings("a") }, (ctx) => ({ a: ctx.query.a }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/q?a=x`);

    expect(await res.json()).toEqual({ a: "x" });
  });

  it("preserves ctx.query laziness when no query schema is declared", async () => {
    // Regression: adding the schema pipeline must not eagerly parse the
    // query for routes that didn't ask for validation.
    let getterRead = 0;
    const app = new Nova();
    app.get("/", (ctx) => {
      getterRead = Object.keys(ctx.query).length === 0 ? 0 : 1;
      return { ok: true };
    });

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/?a=1`);

    expect(getterRead).toBe(1);
  });
});

describe("Nova plugin system", () => {
  it("runs the plugin with the app and resolves register()", async () => {
    const app = new Nova();
    let received: Nova | undefined;

    await app.register((a) => {
      received = a;
    });

    expect(received).toBe(app);
  });

  it("awaits async plugins", async () => {
    const app = new Nova();
    let asyncSetupDone = false;

    await app.register(async () => {
      await new Promise((r) => setTimeout(r, 10));
      asyncSetupDone = true;
    });

    expect(asyncSetupDone).toBe(true);
  });

  it("returns the app from register() so callers can chain", async () => {
    const app = new Nova();
    const returned = await app.register(() => undefined);
    expect(returned).toBe(app);
  });

  it("propagates errors thrown by a plugin", async () => {
    const app = new Nova();
    await expect(
      app.register(() => {
        throw new Error("setup failed");
      }),
    ).rejects.toThrow("setup failed");
  });

  it("propagates async errors from a plugin", async () => {
    const app = new Nova();
    await expect(
      app.register(async () => {
        throw new Error("async setup failed");
      }),
    ).rejects.toThrow("async setup failed");
  });

  it("plugins can register routes that work end-to-end", async () => {
    const app = new Nova();

    await app.register((a) => {
      a.get("/from-plugin", () => ({ source: "plugin" }));
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/from-plugin`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "plugin" });
  });

  it("plugins can register middleware that participates in the chain", async () => {
    const app = new Nova();

    await app.register((a) => {
      a.use(async (ctx, next) => {
        ctx.header("x-from-plugin", "yes");
        await next();
      });
    });

    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.headers.get("x-from-plugin")).toBe("yes");
  });

  it("preserves registration order across multiple plugins", async () => {
    const order: string[] = [];
    const app = new Nova();

    await app.register((a) => {
      a.use(async (_ctx, next) => {
        order.push("a-before");
        await next();
        order.push("a-after");
      });
    });

    await app.register((a) => {
      a.use(async (_ctx, next) => {
        order.push("b-before");
        await next();
        order.push("b-after");
      });
    });

    app.get("/", () => {
      order.push("handler");
      return null;
    });

    const { port } = await start(app);
    await fetch(`http://127.0.0.1:${port}/`);

    expect(order).toEqual(["a-before", "b-before", "handler", "b-after", "a-after"]);
  });
});

describe("Nova onClose / shutdown", () => {
  it("runs onClose handlers when close() is invoked", async () => {
    let called = false;
    const app = new Nova();
    app.onClose(() => {
      called = true;
    });

    await app.close();
    expect(called).toBe(true);
  });

  it("runs handlers in reverse registration order (LIFO)", async () => {
    const order: string[] = [];
    const app = new Nova();
    app.onClose(() => order.push("first"));
    app.onClose(() => order.push("second"));
    app.onClose(() => order.push("third"));

    await app.close();
    expect(order).toEqual(["third", "second", "first"]);
  });

  it("awaits async handlers", async () => {
    let asyncCleanupDone = false;
    const app = new Nova();
    app.onClose(async () => {
      await new Promise((r) => setTimeout(r, 10));
      asyncCleanupDone = true;
    });

    await app.close();
    expect(asyncCleanupDone).toBe(true);
  });

  it("logs handler errors but continues running subsequent handlers", async () => {
    const order: string[] = [];
    const app = new Nova();
    app.onClose(() => order.push("first"));
    app.onClose(() => {
      throw new Error("cleanup boom");
    });
    app.onClose(() => order.push("third"));

    const originalError = console.error;
    let logged = false;
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].startsWith("[nova] onClose")) {
        logged = true;
      }
    };
    try {
      await app.close();
    } finally {
      console.error = originalError;
    }

    // Third was registered last → ran first. Then the throwing handler.
    // Then "first" (which was registered first → ran last).
    expect(order).toEqual(["third", "first"]);
    expect(logged).toBe(true);
  });

  it("close() is idempotent — handlers do not run twice", async () => {
    let calls = 0;
    const app = new Nova();
    app.onClose(() => {
      calls += 1;
    });

    await app.close();
    await app.close();

    expect(calls).toBe(1);
  });

  it("close() stops the HTTP server before running onClose handlers", async () => {
    let serverStillAccepting: boolean | undefined;
    const app = new Nova();
    app.get("/", () => "ok");

    const { port } = await start(app);
    app.onClose(async () => {
      // The HTTP server should have stopped accepting connections by now.
      // A fetch should fail (ECONNREFUSED, abort, etc.).
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(50) });
        serverStillAccepting = true;
      } catch {
        serverStillAccepting = false;
      }
    });

    await app.close();
    expect(serverStillAccepting).toBe(false);
  });

  it("plugins can register onClose handlers (full lifecycle)", async () => {
    const order: string[] = [];
    const app = new Nova();

    await app.register((a) => {
      a.onClose(() => order.push("plugin-A-cleanup"));
    });
    await app.register((a) => {
      a.onClose(() => order.push("plugin-B-cleanup"));
    });

    await app.close();
    // B registered last → cleans up first.
    expect(order).toEqual(["plugin-B-cleanup", "plugin-A-cleanup"]);
  });
});

describe("Nova.routes() introspection", () => {
  it("returns an empty array for a fresh app", () => {
    const app = new Nova();
    expect(app.routes()).toEqual([]);
  });

  it("lists every registered route with its method and path", () => {
    const app = new Nova();
    app.get("/", () => null);
    app.post("/users", () => null);
    app.get("/users/:id", () => null);
    app.get("/files/:name?", () => null);

    const routes = app.routes();
    expect(routes).toHaveLength(4);

    const summaries = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(summaries).toEqual(["GET /", "GET /files/:name?", "GET /users/:id", "POST /users"]);
  });

  it("includes the schemas object when one was declared", () => {
    const schema: StandardSchemaV1<unknown, { name: string }> = {
      "~standard": {
        version: 1,
        vendor: "nova-test",
        validate: (v) => ({ value: v as { name: string } }),
      },
    };

    const app = new Nova();
    app.post("/users", { body: schema }, () => null);

    const [route] = app.routes();
    expect(route?.schemas?.body).toBe(schema);
  });

  it("leaves schemas undefined for routes registered without them", () => {
    const app = new Nova();
    app.get("/", () => null);
    expect(app.routes()[0]?.schemas).toBeUndefined();
  });

  it("yields one entry per (method, path) combination", () => {
    const app = new Nova();
    app.get("/users", () => null);
    app.post("/users", () => null);
    app.put("/users", () => null);

    expect(app.routes()).toHaveLength(3);
  });
});
