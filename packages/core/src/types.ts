import type { Method } from "@novajs/router";
import type { StandardSchemaV1 } from "@novajs/validator";
// Type-only — `verbatimModuleSyntax` erases this so the circularity with
// application.ts has no runtime effect.
import type { Nova } from "./application.js";
import type { Context } from "./context.js";
import type { ExtractParams } from "./path-params.js";
import type { QueryRecord } from "./query.js";

/**
 * Route handler. Receives the request {@link Context}; returns a value
 * Nova serializes per its polymorphic response policy.
 *
 * ```ts
 * app.get("/users/:id", (ctx) => ctx.params.id);   // string
 * app.get("/users/:id", { params: z.object({ id: z.coerce.number() }) },
 *   (ctx) => ctx.params.id);                       // number
 * ```
 */
export type Handler<
  TPath extends string = string,
  TBody = undefined,
  TQuery = QueryRecord,
  TParams = ExtractParams<TPath>,
> = (ctx: Context<TPath, TBody, TQuery, TParams>) => unknown | Promise<unknown>;

/**
 * Per-route metadata consumed by the OpenAPI generator. Lives in core
 * (rather than `@novajs/openapi`) so route registration can carry the data
 * without a circular package dependency.
 */
export interface OpenApiRouteMetadata {
  readonly summary?: string;
  /** Supports CommonMark in OpenAPI tools. */
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  /**
   * Override the auto-generated id. Defaults to
   * `${method}${pathSegmentsPascalCased}` — e.g. `getUsersById`.
   */
  readonly operationId?: string;
}

/**
 * Route-level schemas for input validation and output documentation. Each
 * schema must implement {@link StandardSchemaV1}.
 *
 * `responses` is documentation-only — runtime validation of handler return
 * values is a post-v1.0 concern.
 */
export interface RouteSchemas {
  readonly body?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly params?: StandardSchemaV1;
  readonly responses?: Readonly<Record<number, StandardSchemaV1>>;
  readonly openapi?: OpenApiRouteMetadata;
}

/**
 * Subset of {@link RouteSchemas} permitted on methods with no request body
 * (GET, HEAD, OPTIONS). `body` is excluded at the type level.
 */
export type NoBodyRouteSchemas = Omit<RouteSchemas, "body">;

/** Inferred `ctx.body` type for a given {@link RouteSchemas}. */
export type InferBody<S extends RouteSchemas> = S extends { readonly body: infer B }
  ? B extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<B>
    : undefined
  : undefined;

/**
 * Inferred `ctx.query` type. Falls back to {@link QueryRecord} when no
 * query schema is declared.
 */
export type InferQuery<S extends RouteSchemas | NoBodyRouteSchemas | undefined> = S extends {
  readonly query: infer Q;
}
  ? Q extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<Q>
    : QueryRecord
  : QueryRecord;

/**
 * Inferred `ctx.params` type. Falls back to `ExtractParams<TPath>` when no
 * params schema is declared.
 */
export type InferParams<
  S extends RouteSchemas | NoBodyRouteSchemas | undefined,
  TPath extends string,
> = S extends { readonly params: infer P }
  ? P extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<P>
    : ExtractParams<TPath>
  : ExtractParams<TPath>;

/**
 * Global error handler. Receives the thrown value (which may not be an
 * `Error`) and the request context. If the handler does not produce a
 * response, Nova falls back to its default rendering policy.
 */
export type ErrorHandler = (err: unknown, ctx: Context) => void | Promise<void>;

/** Options accepted by the {@link Nova} constructor. */
export interface NovaOptions {
  /**
   * Maximum request body size in bytes. Bodies that exceed are rejected
   * with `413 Payload Too Large`. Defaults to `1 MiB`.
   */
  readonly bodyLimit?: number;
}

/** Result of {@link Nova.listen}. */
export interface ListenResult {
  readonly address: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * One row in {@link Nova.routes}. Used by introspection tools (e.g. the
 * OpenAPI generator) to enumerate registered routes. `schemas` is the
 * same reference passed at registration — treat as read-only.
 */
export interface RegisteredRoute {
  readonly method: Method;
  readonly path: string;
  readonly schemas: RouteSchemas | undefined;
}

/**
 * Boot-time configuration function. Registered via {@link Nova.register}
 * and run once — conceptually distinct from middleware, which runs per
 * request. Async setup (DB pools, config reads) is supported.
 *
 * ```ts
 * const db: Plugin = async (app) => {
 *   const pool = await createPool();
 *   app.onClose(() => pool.end());
 * };
 *
 * await app.register(db);
 * ```
 */
export type Plugin = (app: Nova) => void | Promise<void>;

/**
 * Cleanup callback registered via {@link Nova.onClose}. Invoked after the
 * HTTP server stops accepting connections.
 *
 * Handlers run in reverse registration order (LIFO) — resources opened
 * later are torn down first. A throwing handler is logged but does not
 * abort the chain.
 */
export type CloseHandler = () => void | Promise<void>;
