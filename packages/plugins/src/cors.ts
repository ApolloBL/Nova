/**
 * Cross-Origin Resource Sharing plugin.
 *
 * Implements the
 * [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol):
 * handles preflights, attaches the right response headers on regular
 * cross-origin requests, and lets non-CORS traffic through unchanged.
 *
 * ```ts
 * await app.register(cors());                                    // any origin
 * await app.register(cors({ origin: "https://app.example.com" }));
 * await app.register(cors({ origin: /\.example\.com$/, credentials: true }));
 * ```
 */
import type { Context, Middleware, Plugin } from "@novats/core";

/**
 * Allowed-origin policy.
 *
 * - `"*"` — any origin. Echoed verbatim; incompatible with `credentials: true`.
 * - `string` — exact match.
 * - `string[]` — allowlist membership.
 * - `RegExp` — pattern match.
 * - function — fully dynamic decision (sync or async).
 */
export type OriginPolicy =
  | "*"
  | string
  | readonly string[]
  | RegExp
  | ((origin: string) => boolean | Promise<boolean>);

/** Configuration accepted by {@link cors}. */
export interface CorsOptions {
  /** Allowed origin(s). Defaults to `"*"`. */
  readonly origin?: OriginPolicy;
  /** Methods advertised in preflight `Access-Control-Allow-Methods`. */
  readonly methods?: readonly string[];
  /**
   * Headers advertised in preflight `Access-Control-Allow-Headers`. When
   * unset, the request's `Access-Control-Request-Headers` is reflected.
   */
  readonly allowedHeaders?: readonly string[];
  /** Response headers exposed via `Access-Control-Expose-Headers`. */
  readonly exposedHeaders?: readonly string[];
  /** Whether to send `Access-Control-Allow-Credentials: true`. */
  readonly credentials?: boolean;
  /** `Access-Control-Max-Age` value in seconds. */
  readonly maxAge?: number;
}

interface ResolvedOptions {
  readonly origin: OriginPolicy;
  readonly methods: readonly string[];
  readonly allowedHeaders: readonly string[] | undefined;
  readonly exposedHeaders: readonly string[] | undefined;
  readonly credentials: boolean;
  readonly maxAge: number | undefined;
}

const DEFAULT_METHODS: readonly string[] = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

/**
 * Builds a CORS plugin. Options are resolved once at construction — no
 * per-request option parsing.
 */
export function cors(options: CorsOptions = {}): Plugin {
  const resolved = resolveOptions(options);
  const middleware = makeCorsMiddleware(resolved);
  return (app) => {
    app.use(middleware);
  };
}

function resolveOptions(options: CorsOptions): ResolvedOptions {
  const origin = options.origin ?? "*";
  const credentials = options.credentials ?? false;

  if (origin === "*" && credentials) {
    throw new Error(
      "CORS: `origin: '*'` is incompatible with `credentials: true` per the " +
        "Fetch spec. Use a concrete origin (string / array / regex / function) " +
        "or set `credentials: false`.",
    );
  }

  return {
    origin,
    methods: options.methods ?? DEFAULT_METHODS,
    allowedHeaders: options.allowedHeaders,
    exposedHeaders: options.exposedHeaders,
    credentials,
    maxAge: options.maxAge,
  };
}

function makeCorsMiddleware(opts: ResolvedOptions): Middleware {
  return async (ctx, next) => {
    const requestOrigin = readHeader(ctx, "origin");

    // No Origin header → not a CORS request.
    if (requestOrigin === undefined) {
      return next();
    }

    const allowed = await resolveOrigin(requestOrigin, opts.origin);

    // Denied: pass through without CORS headers. The browser will block
    // the response client-side; we avoid leaking the allowlist via 403.
    if (allowed === false) {
      return next();
    }

    const isPreflight =
      ctx.method === "OPTIONS" && readHeader(ctx, "access-control-request-method") !== undefined;

    if (isPreflight) {
      handlePreflight(ctx, opts, allowed);
      return;
    }

    handleRegular(ctx, opts, allowed);
    return next();
  };
}

/**
 * Headers common to every CORS-relevant response. Returns the `Vary`
 * dimensions accumulated so far so the caller can append its branch-
 * specific dimensions before flushing.
 */
function applyCommonHeaders(ctx: Context, opts: ResolvedOptions, allowed: string): string[] {
  ctx.header("access-control-allow-origin", allowed);

  if (opts.credentials) {
    ctx.header("access-control-allow-credentials", "true");
  }
  if (opts.exposedHeaders !== undefined && opts.exposedHeaders.length > 0) {
    ctx.header("access-control-expose-headers", opts.exposedHeaders.join(", "));
  }

  // `Vary: Origin` is required whenever the response depends on the origin.
  return allowed === "*" ? [] : ["Origin"];
}

/** Builds the full preflight response: common headers + Allow-Methods/Headers/Max-Age + 204. */
function handlePreflight(ctx: Context, opts: ResolvedOptions, allowed: string): void {
  const varyDims = applyCommonHeaders(ctx, opts, allowed);

  ctx.header("access-control-allow-methods", opts.methods.join(", "));

  if (opts.allowedHeaders !== undefined) {
    ctx.header("access-control-allow-headers", opts.allowedHeaders.join(", "));
  } else {
    // Reflecting the requested headers requires Vary on that header for cache correctness.
    const requested = readHeader(ctx, "access-control-request-headers");
    if (requested !== undefined) {
      ctx.header("access-control-allow-headers", requested);
      varyDims.push("Access-Control-Request-Headers");
    }
  }

  if (opts.maxAge !== undefined) {
    ctx.header("access-control-max-age", String(opts.maxAge));
  }

  appendVary(ctx, varyDims);
  ctx.noContent();
}

/** Decorates a regular cross-origin response with the headers required to release it. */
function handleRegular(ctx: Context, opts: ResolvedOptions, allowed: string): void {
  const varyDims = applyCommonHeaders(ctx, opts, allowed);
  appendVary(ctx, varyDims);
}

/**
 * Resolves a request's origin against the policy. Returns the value to put
 * in `Access-Control-Allow-Origin`, or `false` if denied.
 */
async function resolveOrigin(requestOrigin: string, policy: OriginPolicy): Promise<string | false> {
  if (policy === "*") return "*";
  if (typeof policy === "string") {
    return policy === requestOrigin ? requestOrigin : false;
  }
  if (policy instanceof RegExp) {
    return policy.test(requestOrigin) ? requestOrigin : false;
  }
  if (typeof policy === "function") {
    return (await policy(requestOrigin)) ? requestOrigin : false;
  }
  return policy.includes(requestOrigin) ? requestOrigin : false;
}

/** Reads a request header by name. Returns the first value when multiple. */
function readHeader(ctx: Context, name: string): string | undefined {
  const value = ctx.raw.req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/** Appends to `Vary`, preserving upstream values and skipping duplicates. */
function appendVary(ctx: Context, additions: readonly string[]): void {
  if (additions.length === 0) return;

  const existing = ctx.raw.res.getHeader("vary");
  const current =
    typeof existing === "string"
      ? existing
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

  for (const name of additions) {
    if (!current.includes(name)) current.push(name);
  }

  ctx.header("vary", current.join(", "));
}
