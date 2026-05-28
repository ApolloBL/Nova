# @novats/core

The `Nova` application, the Node HTTP adapter, and the request `Context`.

> 🚧 Pre-release. Public API is not stable yet.

## Install

```bash
pnpm add @novats/core
```

## Quick start

```ts
import { Nova } from "@novats/core";

const app = new Nova();

app.get("/", () => ({ hello: "world" }));

const { port } = await app.listen(3000);
console.log(`Listening on http://127.0.0.1:${port}`);
```

## API surface

### `class Nova`

| Method                                              | What it does                                          |
| --------------------------------------------------- | ----------------------------------------------------- |
| `app.get(path, handler)`                            | Register a `GET` route.                               |
| `app.post(path, handler)`                           | Register a `POST` route.                              |
| `app.put` / `patch` / `delete` / `head` / `options` | Same shape, different method.                         |
| `app.listen(port, host?)`                           | Start the server. Returns `{ address, port, close }`. |
| `app.close()`                                       | Stop the server. Idempotent.                          |

- Each registration method is generic over the literal path:
  `app.get<TPath extends string>(path: TPath, handler: Handler<TPath>)`.
  The handler's `ctx.params` is typed from the path with no extra annotation.
- Duplicate registrations throw immediately (`"Route already registered: …"`).
- Two patterns with the same matching shape but different parameter names
  (e.g. `/users/:id` and `/users/:userId`) throw `"Route conflict: …"`.
- `host` defaults to `127.0.0.1`. Pass `"0.0.0.0"` to bind all interfaces.
- `port: 0` lets the OS pick a free port; the resolved port is in the result.

### `class Context<TPath, TBody, TQuery, TParams>`

Per-request object handed to every handler.

| Member              | Type                                       | Purpose                                                     |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `ctx.method`        | `string`                                   | Uppercase HTTP method (e.g. `"GET"`).                       |
| `ctx.path`          | `string`                                   | Request path with query string stripped.                    |
| `ctx.params`        | `TParams` (default `ExtractParams<TPath>`) | Route parameters; type override-able by a `params` schema.  |
| `ctx.query`         | `TQuery` (default `QueryRecord`)           | Parsed query; type override-able by a `query` schema.       |
| `ctx.body`          | `TBody` (default `undefined`)              | Validated body; populated when a `body` schema is declared. |
| `ctx.status(code)`  | `(code: number) => this`                   | Set status code. Chainable.                                 |
| `ctx.header(n, v)`  | `(name, value) => this`                    | Set a response header (case-insensitive). Chainable.        |
| `ctx.json(body)`    | `(body: unknown) => void`                  | Send a JSON body.                                           |
| `ctx.text(body)`    | `(body: string) => void`                   | Send a `text/plain` body.                                   |
| `ctx.binary(bytes)` | `(body: Uint8Array, type?) => void`        | Send raw bytes (default `application/octet-stream`).        |
| `ctx.noContent()`   | `() => void`                               | Send `204 No Content`.                                      |
| `ctx.sent`          | `boolean`                                  | Whether the response has been written.                      |
| `ctx.raw`           | `{ req, res }`                             | Escape hatch to the underlying `node:http` objects.         |

Calling any setter after the response is sent throws.

## Route parameters (`ctx.params`)

Path patterns may contain `:name` placeholders. The shape of `ctx.params` is
extracted from the literal path at compile time:

```ts
app.get("/users/:id", (ctx) => {
  ctx.params.id; // string
});

app.get("/users/:userId/posts/:postId", (ctx) => {
  ctx.params.userId; // string
  ctx.params.postId; // string
});

app.get("/files/:name?", (ctx) => {
  ctx.params.name; // string | undefined  (trailing `?` makes it optional)
});
```

Rules:

- Optional parameters (`:name?`) are only allowed as the **last** segment.
- Parameter names must match `/[A-Za-z_][A-Za-z0-9_]*/`.
- Static routes always win over parametric ones at the same depth — registering
  both `/users/me` and `/users/:id` is fine and unambiguous.

## Query string (`ctx.query`)

`ctx.query` is a frozen, null-prototype record. It is parsed lazily: handlers
that never read `ctx.query` pay zero cost.

```ts
app.get("/search", (ctx) => {
  const q = ctx.query["q"]; // string | readonly string[] | undefined
  const page = ctx.query["page"] ?? "1";
  return { q, page };
});
```

Semantics:

| Input                                     | `ctx.query` shape           |
| ----------------------------------------- | --------------------------- |
| `(no query)`                              | `{}`                        |
| `?q=hello`                                | `{ q: "hello" }`            |
| `?q=hello&page=2`                         | `{ q: "hello", page: "2" }` |
| `?ids=1&ids=2`                            | `{ ids: ["1", "2"] }`       |
| `?flag`                                   | `{ flag: "" }`              |
| `?msg=hello%20world` / `?msg=hello+world` | `{ msg: "hello world" }`    |

Security:

- The record has a `null` prototype, so `ctx.query.toString` is `undefined`
  rather than the inherited `Object.prototype.toString`.
- The keys `__proto__`, `constructor`, and `prototype` are silently dropped at
  parse time. A handler that needs to see those should read `ctx.raw.req.url`.

## Middleware

Nova uses the **onion** middleware model. `app.use(mw)` registers a
function that wraps the chain:

```ts
const timing: Middleware = async (ctx, next) => {
  const t0 = performance.now();
  await next(); // run downstream + handler
  ctx.header("x-elapsed-ms", `${performance.now() - t0}`);
};

app.use(timing);
app.use(auth);
app.get("/users/:id", handler);
```

### Order

Middleware run in **registration order** before the matched handler and in
**reverse order** after it:

```
timing.before  →  auth.before  →  handler  →  auth.after  →  timing.after
```

### Short-circuit

A middleware that does **not** call `next()` prevents the handler (and any
downstream middleware) from running. After-phases of _upstream_ middleware
still execute — they were already past their own `await next()`. This is the
guard pattern:

```ts
app.use((ctx, next) => {
  if (!authorized(ctx)) {
    ctx.status(401).json({ error: "unauthorized" });
    return; // no next() → handler is skipped
  }
  return next();
});
```

### Errors

A throw (sync or async) propagates as a promise rejection through every
`await next()`. An upstream middleware can recover with `try/catch`; anything
uncaught lands in Nova's outer try/catch and produces a `500`:

```ts
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status(502).json({ error: "Upstream failure" });
  }
});
```

`next()` may be called **at most once** per middleware. A second call rejects
with `"next() called multiple times"`.

### `ctx.state` for inter-middleware data

Middleware communicates via `ctx.state` — a per-request object created with a
`null` prototype:

```ts
app.use(async (ctx, next) => {
  ctx.state["requestId"] = crypto.randomUUID();
  await next();
});

app.get("/", (ctx) => ({ id: ctx.state["requestId"] }));
```

For typed access, augment the `ContextState` interface:

```ts
declare module "@novats/core" {
  interface ContextState {
    readonly requestId?: string;
    readonly user?: { id: string; name: string };
  }
}

// now `ctx.state.requestId` has type `string | undefined`.
```

### Type

```ts
type Next = () => Promise<void>;
type Middleware = (ctx: Context, next: Next) => void | Promise<void>;
```

## Polymorphic return values

If the handler **returns** a value (instead of calling `ctx.json` etc.), the
content type is inferred:

| Returned value          | Status | Content-Type                      |
| ----------------------- | -----: | --------------------------------- |
| `undefined` / `null`    |    204 | (no body)                         |
| `string`                |    200 | `text/plain; charset=utf-8`       |
| `Uint8Array` / `Buffer` |    200 | `application/octet-stream`        |
| anything else           |    200 | `application/json; charset=utf-8` |

If the handler already sent a response through the `Context`, the return value
is ignored — explicit sends always win.

## Input validation

Routes optionally declare schemas for `body`, `query`, and `params`. Each
schema must implement the [Standard Schema v1](https://standardschema.dev)
contract, so Nova works with **Zod (≥ 3.24), Valibot, ArkType, Effect
Schema, or any other validator** that adopts the spec — without a dependency
on any of them.

```ts
import { Nova } from "@novats/core";
import { z } from "zod";

const app = new Nova();

const CreateUser = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
});

app.post("/users", { body: CreateUser }, (ctx) => {
  // ctx.body is `{ name: string; age: number }` — typed from the schema.
  return { user: ctx.body };
});

app.get("/posts/:id", { params: z.object({ id: z.coerce.number() }) }, (ctx) => {
  // ctx.params.id is `number`, not `string` — the schema coerces.
  return { id: ctx.params.id };
});

app.get(
  "/search",
  { query: z.object({ q: z.string(), page: z.coerce.number().default(1) }) },
  (ctx) => ({ q: ctx.query.q, page: ctx.query.page }),
);
```

### Schemas object

```ts
interface RouteSchemas {
  readonly body?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly params?: StandardSchemaV1;
}
```

Body schemas are **only allowed on `POST`, `PUT`, `PATCH`, `DELETE`**.
`GET`, `HEAD`, and `OPTIONS` accept `NoBodyRouteSchemas` (= `RouteSchemas`
without `body`) — TypeScript rejects body schemas on those methods at
compile time.

### Validation order and error response

`params → query → body`. Cheap input is validated before expensive I/O,
but **all** declared sources run so the client gets a complete picture in
one round-trip. Failures from any source are aggregated into a single `422`:

```json
{
  "error": "Unprocessable Entity",
  "issues": [
    { "source": "params", "message": "Expected number", "path": ["id"] },
    { "source": "query", "message": "Required", "path": ["q"] },
    { "source": "body", "message": "Expected string", "path": ["name"] }
  ]
}
```

Each issue carries a `source` tag so a client form can render errors next to
the right input. The `message` and `path` come straight from the validator.

### Body parsing

When a `body` schema is declared, Nova reads the request stream as JSON
before invoking the schema.

| Failure mode                       | Status | Cause                                                  |
| ---------------------------------- | -----: | ------------------------------------------------------ |
| Body exceeds `bodyLimit`           |    413 | Bytes read pass the cap (default 1 MiB).               |
| Body bytes are not valid JSON      |    400 | `JSON.parse` throws (`SyntaxError` attached as cause). |
| JSON parses but the schema rejects |    422 | At least one source emits issues.                      |

The limit is configurable: `new Nova({ bodyLimit: 4 * 1024 * 1024 })`.

### Middleware runs before validation

The middleware chain executes before Nova reads or validates any input.
Guards (auth, rate-limit) can short-circuit before the body is even drained
from the wire — useful for unauthenticated requests with large payloads.

### Using a validator that is not yet Standard Schema-compatible

The `StandardSchemaV1` interface is small enough to implement by hand:

```ts
import type { StandardSchemaV1 } from "@novats/core";

const PositiveInt: StandardSchemaV1<unknown, number> = {
  "~standard": {
    version: 1,
    vendor: "my-app",
    validate: (value) =>
      Number.isInteger(value) && (value as number) > 0
        ? { value: value as number }
        : { issues: [{ message: "Expected positive integer" }] },
  },
};
```

## Errors

Throwing an `HttpError` from a handler or middleware produces a structured
HTTP response. Throwing anything else (`Error`, `string`, …) produces a
generic `500`.

```ts
import { Nova, HttpError, notFound, unauthorized } from "@novats/core";

const app = new Nova();

app.get("/users/:id", (ctx) => {
  if (ctx.params.id === "0") throw notFound(`User ${ctx.params.id} not found`);
  return { id: ctx.params.id };
});

app.get("/admin", () => {
  throw unauthorized("token required", {
    headers: { "WWW-Authenticate": 'Bearer realm="api"' },
  });
});
```

### `class HttpError`

```ts
new HttpError(status, message?, {
  expose?: boolean;          // default: status < 500
  cause?: unknown;            // ES2022 cause chain
  body?: unknown;             // replaces the default body
  headers?: Record<string, string>;
});
```

### Convenience factories

`badRequest`, `unauthorized`, `forbidden`, `notFound`, `methodNotAllowed`,
`conflict`, `gone`, `payloadTooLarge`, `unsupportedMediaType`,
`unprocessableEntity`, `tooManyRequests`, `internalServerError`,
`notImplemented`, `badGateway`, `serviceUnavailable`, `gatewayTimeout`.

Each accepts `(message?, options?)` and returns an `HttpError`. There is
also a generic `httpError(status, message?, options?)`.

### Expose policy

| Status | Default `expose` | Result                       |
| ------ | ---------------- | ---------------------------- |
| 4xx    | `true`           | `message` sent to the client |
| 5xx    | `false`          | `message` kept server-side   |

The default body is `{ error: "<reason phrase>", message?: "<message>" }`.
A custom `body` in the options replaces the entire shape.

### `app.onError`

```ts
type ErrorHandler = (err: unknown, ctx: Context) => void | Promise<void>;

app.onError((err, ctx) => {
  // log / report / format
  if (!(err instanceof HttpError)) console.error(err);
});
```

- If the handler writes a response (`ctx.json` / `ctx.status` / …), Nova
  uses it as-is.
- If the handler returns without writing, Nova falls back to its default
  HttpError-aware rendering.
- If the handler itself throws, Nova logs the inner error and falls back to
  the default rendering for the **original** error.

Setting `onError` suppresses Nova's automatic logging — the policy is yours.
By default, Nova logs only `5xx` (HttpError or otherwise) to `stderr`; `4xx`
HttpErrors are silent.

## Roadmap

See the [root README](../../README.md#roadmap) for upcoming versions.
