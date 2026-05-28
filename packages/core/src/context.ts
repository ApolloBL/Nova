import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtractParams } from "./path-params.js";
import { parseQueryString, type QueryRecord } from "./query.js";

/**
 * Escape hatch to the underlying Node primitives. Isolated here so a future
 * Bun/Deno adapter is a focused refactor rather than a rewrite.
 */
export interface RawNodeHttp {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
}

/**
 * Typed shape for `ctx.state`. Empty by default — augment via module
 * augmentation to add typed fields:
 *
 * ```ts
 * declare module "@novajs/core" {
 *   interface ContextState {
 *     readonly user?: { id: string; name: string };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ContextState {}

/** Internal: triggers the deferred wire flush. Not re-exported. */
export const FINALIZE: unique symbol = Symbol("nova.context.finalize");

/** Internal: assigns the validated request body. Not re-exported. */
export const SET_BODY: unique symbol = Symbol("nova.context.setBody");

/** Internal: overrides `ctx.query` with a validated value. Not re-exported. */
export const SET_QUERY: unique symbol = Symbol("nova.context.setQuery");

/** Internal: overrides `ctx.params` with a validated value. Not re-exported. */
export const SET_PARAMS: unique symbol = Symbol("nova.context.setParams");

/**
 * Per-request context handed to every handler.
 *
 * Generic over four axes, each defaulting to the "no schema" shape:
 *
 * - `TPath`   — literal path pattern; drives `ctx.params` inference.
 * - `TBody`   — validated body type (`undefined` when no body schema).
 * - `TQuery`  — validated query type (defaults to {@link QueryRecord}).
 * - `TParams` — validated params type (defaults to `ExtractParams<TPath>`).
 *
 * Response calls (`ctx.json/text/binary/noContent`) buffer the body;
 * `res.end()` runs once the middleware chain completes inside
 * `ctx[FINALIZE]()`. This deferral is what enables after-phase middleware
 * to set headers post-handler.
 */
export class Context<
  TPath extends string = string,
  TBody = undefined,
  TQuery = QueryRecord,
  TParams = ExtractParams<TPath>,
> {
  readonly raw: RawNodeHttp;
  readonly method: string;
  readonly path: string;

  /**
   * Route parameters — derived from the path pattern, or from the `params`
   * schema's output when one is declared.
   */
  readonly params: TParams;

  /**
   * Per-request state bag. Null-prototype, mutable, lazy (allocated on
   * first read). Augment {@link ContextState} for typed access.
   */
  private lazyState: (ContextState & Record<string, unknown>) | undefined;
  get state(): ContextState & Record<string, unknown> {
    if (this.lazyState === undefined) {
      this.lazyState = Object.create(null) as ContextState & Record<string, unknown>;
    }
    return this.lazyState;
  }

  /** Validated request body. `undefined` when no body schema was declared. */
  body: TBody = undefined as TBody;

  private responseBody: string | Uint8Array | undefined = undefined;
  private bodyDeclared = false;
  private wireFlushed = false;

  private readonly searchString: string;
  private cachedQuery: TQuery | undefined;

  constructor(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    path: string,
    params: TParams,
    search: string,
  ) {
    this.raw = { req, res };
    this.method = method;
    this.path = path;
    this.params = params;
    this.searchString = search;
  }

  [SET_BODY](value: TBody): void {
    this.body = value;
  }

  [SET_PARAMS](value: TParams): void {
    (this as { params: TParams }).params = value;
  }

  [SET_QUERY](value: TQuery): void {
    this.cachedQuery = value;
  }

  /**
   * Parsed query string. Lazy — runs once per request, on first read.
   * When a `query` schema is declared, Nova pre-populates this cache with
   * the validated value and the lazy parse never runs.
   */
  get query(): TQuery {
    if (this.cachedQuery === undefined) {
      this.cachedQuery = parseQueryString(this.searchString) as unknown as TQuery;
    }
    return this.cachedQuery;
  }

  /**
   * Whether a body has been declared. The wire flush itself is deferred
   * until Nova finalizes the response.
   */
  get sent(): boolean {
    return this.bodyDeclared;
  }

  /**
   * Sets the HTTP status code. Chainable. Locks once a body is declared.
   *
   * @throws `RangeError` if `code` is not an integer in `[100, 599]`.
   */
  status(code: number): this {
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new RangeError(
        `Invalid HTTP status code: ${String(code)} (must be an integer in [100, 599])`,
      );
    }
    this.assertWritable("status()");
    this.raw.res.statusCode = code;
    return this;
  }

  /**
   * Sets a response header (case-insensitive). Chainable. Allowed after a
   * body is declared so after-phase middleware can decorate the response;
   * locked only once the wire is flushed.
   */
  header(name: string, value: string): this {
    if (this.wireFlushed) {
      throw new Error("Cannot call header() after the response has been flushed");
    }
    this.raw.res.setHeader(name.toLowerCase(), value);
    return this;
  }

  /** Buffers a JSON body. Sets `content-type: application/json; charset=utf-8` if unset. */
  json(body: unknown): void {
    this.declareBody("application/json; charset=utf-8", JSON.stringify(body));
  }

  /** Buffers a text body. Sets `content-type: text/plain; charset=utf-8` if unset. */
  text(body: string): void {
    this.declareBody("text/plain; charset=utf-8", body);
  }

  /** Buffers a binary body. Defaults to `application/octet-stream`. */
  binary(body: Uint8Array, contentType = "application/octet-stream"): void {
    this.declareBody(contentType, body);
  }

  /** Declares a `204 No Content` response. */
  noContent(): void {
    this.assertWritable("noContent()");
    this.raw.res.statusCode = 204;
    this.responseBody = undefined;
    this.bodyDeclared = true;
  }

  private declareBody(defaultContentType: string, body: string | Uint8Array): void {
    this.assertWritable("response body");
    if (!this.raw.res.hasHeader("content-type")) {
      this.raw.res.setHeader("content-type", defaultContentType);
    }
    this.responseBody = body;
    this.bodyDeclared = true;
  }

  // `header()` deliberately skips this guard so after-phase middleware can
  // decorate the response after the handler has declared its body.
  private assertWritable(operation: string): void {
    if (this.bodyDeclared) {
      throw new Error(`Cannot set ${operation} after a response body has been declared`);
    }
    if (this.wireFlushed) {
      throw new Error(`Cannot set ${operation} after the response has been flushed`);
    }
  }

  /**
   * Flushes the buffered response to the wire. Idempotent. Invoked exactly
   * once per request by Nova after the middleware chain completes.
   */
  [FINALIZE](): void {
    if (this.wireFlushed) return;
    this.wireFlushed = true;
    if (this.responseBody === undefined) {
      this.raw.res.end();
    } else {
      this.raw.res.end(this.responseBody);
    }
  }
}
