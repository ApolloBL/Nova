import { describe, expect, it, vi } from "vitest";
import type { Context } from "./context.js";
import { runChain, type Middleware } from "./middleware.js";

/** Minimal mock context for unit-testing the chain in isolation. */
function makeCtx(): Context {
  return {} as Context;
}

describe("runChain", () => {
  it("resolves immediately for an empty chain", async () => {
    await expect(runChain([], makeCtx())).resolves.toBeUndefined();
  });

  it("runs a single middleware that calls next", async () => {
    const calls: string[] = [];
    const mw: Middleware = async (_ctx, next) => {
      calls.push("before");
      await next();
      calls.push("after");
    };

    await runChain([mw], makeCtx());

    expect(calls).toEqual(["before", "after"]);
  });

  it("runs middleware in onion order", async () => {
    const calls: string[] = [];
    const make =
      (label: string): Middleware =>
      async (_ctx, next) => {
        calls.push(`${label}-before`);
        await next();
        calls.push(`${label}-after`);
      };

    await runChain([make("a"), make("b"), make("c")], makeCtx());

    expect(calls).toEqual(["a-before", "b-before", "c-before", "c-after", "b-after", "a-after"]);
  });

  it("short-circuits when a middleware does not call next", async () => {
    const calls: string[] = [];
    const guard: Middleware = (_ctx, _next) => {
      calls.push("guard");
    };
    const downstream: Middleware = async (_ctx, next) => {
      calls.push("downstream");
      await next();
    };

    await runChain([guard, downstream], makeCtx());

    expect(calls).toEqual(["guard"]);
  });

  it("still runs the upstream after-phase when downstream short-circuits", async () => {
    const calls: string[] = [];
    const upstream: Middleware = async (_ctx, next) => {
      calls.push("u-before");
      await next();
      calls.push("u-after");
    };
    const guard: Middleware = (_ctx, _next) => {
      calls.push("guard");
    };

    await runChain([upstream, guard], makeCtx());

    expect(calls).toEqual(["u-before", "guard", "u-after"]);
  });

  it("propagates errors thrown synchronously", async () => {
    const mw: Middleware = () => {
      throw new Error("sync boom");
    };

    await expect(runChain([mw], makeCtx())).rejects.toThrow("sync boom");
  });

  it("propagates errors from async middleware", async () => {
    const mw: Middleware = async () => {
      throw new Error("async boom");
    };

    await expect(runChain([mw], makeCtx())).rejects.toThrow("async boom");
  });

  it("propagates errors from downstream through awaited next()", async () => {
    const downstream: Middleware = () => {
      throw new Error("downstream");
    };
    const passthrough: Middleware = async (_ctx, next) => {
      await next();
    };

    await expect(runChain([passthrough, downstream], makeCtx())).rejects.toThrow("downstream");
  });

  it("allows upstream to catch downstream errors via try/catch", async () => {
    const caught = vi.fn();
    const downstream: Middleware = () => {
      throw new Error("recoverable");
    };
    const recovery: Middleware = async (_ctx, next) => {
      try {
        await next();
      } catch (err) {
        caught(err);
      }
    };

    await runChain([recovery, downstream], makeCtx());

    expect(caught).toHaveBeenCalledTimes(1);
    expect(caught.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("throws when next() is called more than once", async () => {
    const mw: Middleware = async (_ctx, next) => {
      await next();
      await next();
    };

    await expect(runChain([mw], makeCtx())).rejects.toThrow(/next\(\) called multiple times/);
  });

  it("supports sync middleware that returns the promise from next()", async () => {
    let downstreamRan = false;
    const sync: Middleware = (_ctx, next) => next();
    const downstream: Middleware = (_ctx, _next) => {
      downstreamRan = true;
    };

    await runChain([sync, downstream], makeCtx());

    expect(downstreamRan).toBe(true);
  });

  it("isolates `index` across concurrent invocations", async () => {
    // A buggy chain that calls next() twice in one middleware. A concurrent
    // well-behaved chain must complete normally without inheriting the bug.
    const buggy: Middleware = async (_ctx, next) => {
      await next();
      await next();
    };
    const good: Middleware = async (_ctx, next) => {
      await next();
    };

    const buggyResult = runChain([buggy], makeCtx());
    const goodResult = runChain([good], makeCtx());

    await expect(buggyResult).rejects.toThrow(/multiple times/);
    await expect(goodResult).resolves.toBeUndefined();
  });

  it("passes the same ctx to every middleware in the chain", async () => {
    const ctx = makeCtx();
    const seen: unknown[] = [];
    const tap: Middleware = async (c, next) => {
      seen.push(c);
      await next();
    };

    await runChain([tap, tap, tap], ctx);

    expect(seen).toEqual([ctx, ctx, ctx]);
  });
});
