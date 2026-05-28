/**
 * Fixed-window rate-limit plugin. Rejects with `429 Too Many Requests`
 * once the limit is reached and emits the standard
 * [IETF `RateLimit-*` headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).
 *
 * ```ts
 * await app.register(rateLimit({ max: 100, windowMs: 60_000 }));
 * ```
 *
 * Behind a proxy, supply a `keyGenerator` that reads `X-Forwarded-For`
 * after validating the proxy chain — the default uses the TCP peer, which
 * is the proxy itself.
 */
import type { Context, Middleware, Plugin } from "@novats/core";

/** Result of a single counter increment. */
export interface RateLimitIncrement {
  /** Requests counted in the active window, including this one. */
  readonly count: number;
  /** Epoch milliseconds at which the active window resets. */
  readonly resetAt: number;
}

/**
 * Pluggable backend for per-key counters. The default is in-memory; swap
 * for Redis to share counters across processes. Sync and async returns
 * are both accepted so the in-memory path pays no Promise overhead.
 */
export interface RateLimitStore {
  /**
   * Atomically registers a hit for `key` within `windowMs` and returns
   * the resulting count plus the window's reset time. Stores must treat
   * each call as the start of a new window when the previous expired.
   */
  increment(key: string, windowMs: number): RateLimitIncrement | Promise<RateLimitIncrement>;

  /** Optional: clears the counter for `key`. */
  reset?(key: string): void | Promise<void>;
}

/** Options accepted by {@link rateLimit}. */
export interface RateLimitOptions {
  /** Maximum requests allowed per window, inclusive. */
  readonly max: number;
  /** Window duration in milliseconds. */
  readonly windowMs: number;
  /** Derives the counter key. Defaults to the TCP remote address. */
  readonly keyGenerator?: (ctx: Context) => string;
  /** Response body sent on 429. Defaults to `"Too Many Requests"`. */
  readonly message?: string;
  /** Status code used on rejection. Defaults to `429`. */
  readonly status?: number;
  /** Whether to emit `RateLimit-*` headers. Defaults to `true`. */
  readonly headers?: boolean;
  /** Skips rate-limiting for selected requests (e.g. health checks). */
  readonly skip?: (ctx: Context) => boolean | Promise<boolean>;
  /**
   * Fire-and-forget hook invoked on rejection — for structured logging
   * or alerting. Errors are logged but do not affect the response.
   */
  readonly onLimit?: (ctx: Context) => void | Promise<void>;
  /** Counter backend. Defaults to in-memory. */
  readonly store?: RateLimitStore;
}

interface ResolvedOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly keyGenerator: (ctx: Context) => string;
  readonly message: string;
  readonly status: number;
  readonly headers: boolean;
  readonly skip: ((ctx: Context) => boolean | Promise<boolean>) | undefined;
  readonly onLimit: ((ctx: Context) => void | Promise<void>) | undefined;
  readonly store: RateLimitStore;
}

/** Options accepted by {@link InMemoryRateLimitStore}. */
export interface InMemoryRateLimitStoreOptions {
  /**
   * Maximum distinct keys tracked at once. Defaults to `10_000`. When
   * exceeded, the oldest entry (by insertion order) is evicted FIFO.
   * Without a cap, a hostile client rotating spoofed IPs could pin
   * unbounded memory.
   */
  readonly maxKeys?: number;
}

/**
 * Default in-memory rate-limit store. Stores `{ count, expiresAt }` per
 * key. Cleanup is lazy — a key is only purged on the next access if its
 * window expired.
 *
 * Size is bounded by `maxKeys` (default `10_000`) with FIFO eviction.
 * LRU would require per-hit bookkeeping that adds no value here — under
 * sustained DoS the cap is the only thing that matters, and under normal
 * traffic entries expire long before eviction triggers.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private readonly maxKeys: number;

  constructor(options: InMemoryRateLimitStoreOptions = {}) {
    const cap = options.maxKeys ?? 10_000;
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error("InMemoryRateLimitStore: `maxKeys` must be a positive integer");
    }
    this.maxKeys = cap;
  }

  /** Distinct keys currently tracked. Exposed for tests. */
  get size(): number {
    return this.entries.size;
  }

  increment(key: string, windowMs: number): RateLimitIncrement {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing === undefined || existing.expiresAt <= now) {
      // New key or expired window — about to (re-)insert. If a brand-new
      // key would exceed the cap, evict the oldest entry first.
      if (existing === undefined && this.entries.size >= this.maxKeys) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      const fresh = { count: 1, expiresAt: now + windowMs };
      this.entries.set(key, fresh);
      return { count: 1, resetAt: fresh.expiresAt };
    }

    existing.count += 1;
    return { count: existing.count, resetAt: existing.expiresAt };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

// Defaults to the TCP peer — correct without a proxy, and never silently
// trusts forwarded headers.
function defaultKeyGenerator(ctx: Context): string {
  return ctx.raw.req.socket.remoteAddress ?? "unknown";
}

function resolveOptions(options: RateLimitOptions): ResolvedOptions {
  if (!Number.isFinite(options.max) || options.max <= 0) {
    throw new Error("rateLimit: `max` must be a positive number");
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new Error("rateLimit: `windowMs` must be a positive number");
  }
  return {
    max: options.max,
    windowMs: options.windowMs,
    keyGenerator: options.keyGenerator ?? defaultKeyGenerator,
    message: options.message ?? "Too Many Requests",
    status: options.status ?? 429,
    headers: options.headers ?? true,
    skip: options.skip,
    onLimit: options.onLimit,
    store: options.store ?? new InMemoryRateLimitStore(),
  };
}

/** Builds a fixed-window rate-limit plugin. */
export function rateLimit(options: RateLimitOptions): Plugin {
  const opts = resolveOptions(options);
  const middleware = makeRateLimitMiddleware(opts);
  return (app) => {
    app.use(middleware);
  };
}

function makeRateLimitMiddleware(opts: ResolvedOptions): Middleware {
  return async (ctx, next) => {
    if (opts.skip !== undefined && (await opts.skip(ctx))) {
      return next();
    }

    const key = opts.keyGenerator(ctx);
    const { count, resetAt } = await opts.store.increment(key, opts.windowMs);

    const remaining = Math.max(0, opts.max - count);
    const resetSecs = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

    if (opts.headers) {
      ctx.header("ratelimit-limit", String(opts.max));
      ctx.header("ratelimit-remaining", String(remaining));
      ctx.header("ratelimit-reset", String(resetSecs));
    }

    if (count > opts.max) {
      if (opts.headers) {
        ctx.header("retry-after", String(resetSecs));
      }
      if (opts.onLimit !== undefined) {
        // Fire-and-forget; errors logged but never bubble.
        void Promise.resolve(opts.onLimit(ctx)).catch((err: unknown) => {
          console.error("[rate-limit] onLimit hook threw:", err);
        });
      }
      ctx.status(opts.status).json({ error: opts.message });
      return; // short-circuit
    }

    return next();
  };
}
