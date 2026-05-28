import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Router, type Method } from "@novajs/router";
import { validateStandard, type StandardSchemaV1 } from "@novajs/validator";
import { readJsonBody } from "./body.js";
import { Context, FINALIZE, SET_BODY, SET_PARAMS, SET_QUERY } from "./context.js";
import { HttpError, STATUS_NAMES, unprocessableEntity } from "./http-error.js";
import { runChain, type Middleware } from "./middleware.js";
import { sendInferred } from "./response.js";
import type {
  CloseHandler,
  ErrorHandler,
  Handler,
  InferBody,
  InferParams,
  InferQuery,
  ListenResult,
  NoBodyRouteSchemas,
  NovaOptions,
  Plugin,
  RegisteredRoute,
  RouteSchemas,
} from "./types.js";

const DEFAULT_BODY_LIMIT = 1024 * 1024;

type IssueSource = "params" | "query" | "body";

interface RouteEntry {
  readonly handler: Handler;
  readonly schemas: RouteSchemas | undefined;
}

/**
 * Nova application.
 *
 * Route methods (`get`, `post`, …) are generic over the literal path so
 * `ctx.params` is typed from the path pattern. Each method optionally
 * accepts a {@link RouteSchemas} object whose `body` / `query` / `params`
 * slots drive both runtime validation and compile-time typing.
 *
 * Methods without HTTP bodies (`get`, `head`, `options`) accept a
 * restricted {@link NoBodyRouteSchemas} that excludes `body` at the type
 * level.
 *
 * Errors thrown anywhere in the chain flow through the user-supplied
 * {@link ErrorHandler} (via `onError`) or the default HttpError-aware
 * rendering.
 */
export class Nova {
  private readonly router = new Router<RouteEntry>();
  private readonly middleware: Middleware[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private readonly bodyLimit: number;
  private errorHandler: ErrorHandler | undefined;
  private server: Server | undefined;

  constructor(options: NovaOptions = {}) {
    this.bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  }

  /** Registers a global middleware. */
  use(middleware: Middleware): this {
    this.middleware.push(middleware);
    return this;
  }

  /** Registers the global error handler. Replaces any previous handler. */
  onError(handler: ErrorHandler): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * Runs a plugin against this app. Plugins execute once, in registration
   * order; async plugins are awaited so I/O setup completes before the next
   * registration runs. A throwing plugin propagates out — typically aborts
   * startup.
   */
  async register(plugin: Plugin): Promise<this> {
    await plugin(this);
    return this;
  }

  /**
   * Registers a cleanup callback for shutdown. Handlers run in LIFO order
   * inside `close()` after the HTTP server stops accepting connections. A
   * throwing handler is logged but does not abort the chain.
   */
  onClose(handler: CloseHandler): this {
    this.closeHandlers.push(handler);
    return this;
  }

  // ─── GET / HEAD / OPTIONS (no body) ──────────────────────────────────────

  /** Register a `GET` handler. */
  get<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `GET` handler with input schemas (no `body` allowed on GET). */
  get<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  get<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("GET", path, schemasOrHandler, maybeHandler);
  }

  /** Register a `HEAD` handler. */
  head<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `HEAD` handler with input schemas. */
  head<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  head<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("HEAD", path, schemasOrHandler, maybeHandler);
  }

  /** Register an `OPTIONS` handler. */
  options<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register an `OPTIONS` handler with input schemas. */
  options<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  options<TPath extends string, S extends NoBodyRouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, undefined, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("OPTIONS", path, schemasOrHandler, maybeHandler);
  }

  // ─── POST / PUT / PATCH / DELETE (with body) ─────────────────────────────

  /** Register a `POST` handler. */
  post<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `POST` handler with input schemas. */
  post<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  post<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("POST", path, schemasOrHandler, maybeHandler);
  }

  /** Register a `PUT` handler. */
  put<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `PUT` handler with input schemas. */
  put<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  put<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("PUT", path, schemasOrHandler, maybeHandler);
  }

  /** Register a `PATCH` handler. */
  patch<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `PATCH` handler with input schemas. */
  patch<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  patch<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("PATCH", path, schemasOrHandler, maybeHandler);
  }

  /** Register a `DELETE` handler. */
  delete<TPath extends string>(path: TPath, handler: Handler<TPath>): this;
  /** Register a `DELETE` handler with input schemas. */
  delete<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemas: S,
    handler: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this;
  delete<TPath extends string, S extends RouteSchemas>(
    path: TPath,
    schemasOrHandler: S | Handler<TPath>,
    maybeHandler?: Handler<TPath, InferBody<S>, InferQuery<S>, InferParams<S, TPath>>,
  ): this {
    return this.dispatchOverload("DELETE", path, schemasOrHandler, maybeHandler);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Starts listening on `port` and `host`. Returns once bound. Pass
   * `port: 0` to let the OS pick a free port (returned in the result).
   *
   * @throws if the app is already listening.
   */
  async listen(port: number, host = "127.0.0.1"): Promise<ListenResult> {
    if (this.server !== undefined) {
      throw new Error("Server is already listening");
    }

    const server = createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onErrorEvt = (err: Error): void => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.off("error", onErrorEvt);
        resolve();
      };
      server.once("error", onErrorEvt);
      server.once("listening", onListening);
      server.listen(port, host);
    });

    this.server = server;

    const addr = server.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("Unexpected server address shape");
    }

    return {
      address: addr.address,
      port: addr.port,
      close: () => this.close(),
    };
  }

  /**
   * Enumerates every registered route. The snapshot is a plain array, safe
   * to iterate and JSON-serialize. Order is not guaranteed.
   */
  routes(): readonly RegisteredRoute[] {
    const out: RegisteredRoute[] = [];
    for (const entry of this.router.entries()) {
      out.push({
        method: entry.method,
        path: entry.path,
        schemas: entry.value.schemas,
      });
    }
    return out;
  }

  /**
   * Stops listening and runs every registered `onClose` handler in LIFO
   * order. Idempotent — a second call is a no-op. Handlers are consumed
   * (cleared from the list) so they cannot run twice.
   */
  async close(): Promise<void> {
    const server = this.server;
    if (server !== undefined) {
      this.server = undefined;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    // LIFO: later registrations may depend on earlier resources.
    const handlers = this.closeHandlers.splice(0).reverse();
    for (const handler of handlers) {
      try {
        await handler();
      } catch (err) {
        console.error("[nova] onClose handler threw:", err);
      }
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  // Args are typed as `unknown` because the public overloads parametrize
  // the handler over TPath/TBody/TQuery/TParams, which is not assignable
  // to the default-shaped `Handler` (function-parameter contravariance).
  private dispatchOverload(
    method: Method,
    path: string,
    schemasOrHandler: unknown,
    maybeHandler: unknown,
  ): this {
    if (typeof schemasOrHandler === "function") {
      return this.registerRoute(method, path, schemasOrHandler as Handler, undefined);
    }
    if (maybeHandler === undefined) {
      throw new Error(`Handler is required for ${method} ${path}`);
    }
    return this.registerRoute(
      method,
      path,
      maybeHandler as Handler,
      schemasOrHandler as RouteSchemas,
    );
  }

  private registerRoute<TPath extends string>(
    method: Method,
    path: TPath,
    handler: Handler<TPath> | Handler,
    schemas: RouteSchemas | undefined,
  ): this {
    this.router.add(method, path, {
      // The route generics are compile-time only; the router stores the
      // handler under its erased shape.
      handler: handler as unknown as Handler,
      schemas,
    });
    return this;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase() as Method;
    const rawUrl = req.url ?? "/";
    const queryIndex = rawUrl.indexOf("?");
    const path = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
    const search = queryIndex === -1 ? "" : rawUrl.slice(queryIndex);

    const match = this.router.find(method, path);
    const ctx = new Context(req, res, method, path, match?.params ?? EMPTY_PARAMS, search);

    try {
      // Fast path: zero middleware → invoke the handler directly.
      if (this.middleware.length === 0) {
        await this.executeMatched(req, ctx, match);
      } else {
        await runChain(this.middleware, ctx, () => this.executeMatched(req, ctx, match));
      }
    } catch (err) {
      await this.dispatchError(err, ctx);
    }

    try {
      ctx[FINALIZE]();
    } catch (err) {
      console.error("[nova] finalize error:", err);
    }
  }

  private async executeMatched(
    req: IncomingMessage,
    ctx: Context,
    match: ReturnType<Router<RouteEntry>["find"]>,
  ): Promise<void> {
    if (match === undefined) {
      if (!ctx.sent) ctx.status(404).json({ error: "Not Found" });
      return;
    }

    const { handler, schemas } = match.handler;
    if (schemas !== undefined) {
      await this.validateInputs(req, ctx, schemas);
    }

    const result = await handler(ctx);
    sendInferred(ctx, result);
  }

  /**
   * Validates every declared input source against its schema, aggregating
   * issues into a single 422. Order is params → query → body so cheap
   * inputs validate before the body is read.
   */
  private async validateInputs(
    req: IncomingMessage,
    ctx: Context,
    schemas: RouteSchemas,
  ): Promise<void> {
    const issues: { source: IssueSource; message: string; path?: readonly unknown[] }[] = [];

    if (schemas.params !== undefined) {
      const outcome = await validateStandard(schemas.params, ctx.params);
      if (outcome.ok) {
        ctx[SET_PARAMS](outcome.value as Readonly<Record<string, string>>);
      } else {
        pushIssues(issues, "params", outcome.issues);
      }
    }

    if (schemas.query !== undefined) {
      const outcome = await validateStandard(schemas.query, ctx.query);
      if (outcome.ok) {
        (ctx as Context<string, unknown, unknown>)[SET_QUERY](outcome.value);
      } else {
        pushIssues(issues, "query", outcome.issues);
      }
    }

    if (schemas.body !== undefined) {
      try {
        const raw = await readJsonBody(req, this.bodyLimit);
        const outcome = await validateStandard(schemas.body, raw);
        if (outcome.ok) {
          (ctx as Context<string, unknown>)[SET_BODY](outcome.value);
        } else {
          pushIssues(issues, "body", outcome.issues);
        }
      } catch (err) {
        // Reader errors (invalid JSON, 413) propagate as HttpError, no aggregation.
        if (err instanceof HttpError) throw err;
        throw err;
      }
    }

    if (issues.length > 0) {
      throw unprocessableEntity("Input validation failed", {
        body: { error: "Unprocessable Entity", issues },
      });
    }
  }

  private async dispatchError(err: unknown, ctx: Context): Promise<void> {
    const userHandler = this.errorHandler;

    if (userHandler !== undefined) {
      try {
        await userHandler(err, ctx);
      } catch (handlerErr) {
        console.error("[nova] error handler threw:", handlerErr);
        applyDefaultRendering(err, ctx);
        return;
      }

      if (!ctx.sent) {
        applyDefaultRendering(err, ctx);
      }
      return;
    }

    applyDefaultRendering(err, ctx);
  }
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

function pushIssues(
  out: { source: IssueSource; message: string; path?: readonly unknown[] }[],
  source: IssueSource,
  issues: readonly StandardSchemaV1.Issue[],
): void {
  for (const issue of issues) {
    out.push({
      source,
      message: issue.message,
      ...(issue.path !== undefined ? { path: issue.path } : {}),
    });
  }
}

function applyDefaultRendering(err: unknown, ctx: Context): void {
  if (ctx.sent) return;

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      console.error("[nova] handler error:", err);
    }
    renderHttpError(err, ctx);
    return;
  }

  console.error("[nova] handler error:", err);
  try {
    ctx.status(500).json({ error: "Internal Server Error" });
  } catch {
    // Already declared by a racing write.
  }
}

function renderHttpError(err: HttpError, ctx: Context): void {
  try {
    ctx.status(err.status);
    for (const [name, value] of Object.entries(err.headers)) {
      ctx.header(name, value);
    }
    if (err.body !== undefined) {
      ctx.json(err.body);
      return;
    }
    const body: { error: string; message?: string } = {
      error: STATUS_NAMES[err.status] ?? "Error",
    };
    if (err.expose && err.message !== "") {
      body.message = err.message;
    }
    ctx.json(body);
  } catch {
    // Racing write — accept it.
  }
}
