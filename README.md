# Nova

> Modern TypeScript-first backend framework — less boilerplate, automatic typing, production-ready APIs.

**Status:** ✅ v1.0 — API stable.

## Why Nova

- **TypeScript-first.** Types are inferred from your route, not bolted on.
  `ctx.params.id` is `string` straight from `"/users/:id"` — no generics, no casts.
- **Vendor-neutral validation.** `body` / `query` / `params` validate through
  the Standard Schema v1 contract. Zod, Valibot, ArkType, Effect Schema all
  work; Nova depends on none of them.
- **OpenAPI 3.1 built in.** A live spec generated from your routes, plus an
  optional one-flag Swagger UI mount.
- **Onion middleware with deferred flush.** After-phase middleware can decorate
  the response (timing, request-id) after the handler has run.
- **Plugins, not magic.** `app.register(plugin)` for boot-time wiring, distinct
  from per-request middleware, with LIFO `onClose` cleanup.
- **Zero runtime dependencies** in `@novats/core`, `@novats/router`, and
  `@novats/validator`.

## Install

```bash
pnpm add @novats/core
# or
npm install @novats/core
```

Optional companion packages:

| Package             | What it adds                                                 |
| ------------------- | ------------------------------------------------------------ |
| `@novats/plugins`   | `cors`, `rateLimit` plugins (first-party).                   |
| `@novats/openapi`   | Auto-generated OpenAPI 3.1 from your routes + Swagger UI.    |
| `@novats/router`    | Standalone matcher (already pulled in by `@novats/core`).    |
| `@novats/validator` | Standard Schema types (already pulled in by `@novats/core`). |

## Quick start

```ts
import { Nova } from "@novats/core";
import { z } from "zod";

const app = new Nova();

app.get("/", () => ({ hello: "world" }));

app.post(
  "/users",
  { body: z.object({ name: z.string(), age: z.number().int().min(0) }) },
  (ctx) => {
    // ctx.body is `{ name: string; age: number }` — typed from the schema
    return { user: { id: crypto.randomUUID(), ...ctx.body } };
  },
);

app.get("/users/:id", { params: z.object({ id: z.coerce.number() }) }, (ctx) => {
  // ctx.params.id is `number`, not `string` — coerced by the schema
  return { id: ctx.params.id };
});

await app.listen(3000);
```

That's a complete, type-safe, validated HTTP API. No `as` casts, no manual type
parameters, no separate type files.

## Roadmap

| Version  | Scope                                                         | Status |
| -------- | ------------------------------------------------------------- | ------ |
| v0.1     | HTTP server, router, `listen()`, JSON responses               | ✅     |
| v0.2     | Middleware, route params, query parsing, error handling       | ✅     |
| v0.3     | Validation + automatic TypeScript inference (Standard Schema) | ✅     |
| v0.4     | Plugin system (`@novats/plugins`)                             | ✅     |
| v0.5     | Automatic OpenAPI generation (`@novats/openapi`)              | ✅     |
| **v1.0** | **API stability + documentation + security audit**            | ✅     |

## Feature matrix

### Routing

- Static + parametric routes (`/users/:id`)
- Optional trailing parameter (`/files/:name?`)
- Compile-time path-param inference via template-literal types
- Hybrid O(1) static lookup + per-method trie

### Request lifecycle

- Onion-style middleware (`app.use`)
- Per-request `ctx.state` with module-augmentable typing
- Lazy query parsing, null-prototype output, anti-pollution
- Polymorphic return values: object → JSON, string → text/plain, etc.
- Deferred response flush so after-phase mw can set headers post-handler

### Validation

- `body` / `query` / `params` schemas via Standard Schema v1
- Aggregate `422` issues from every source in one response
- Zod, Valibot, ArkType, Effect Schema — Nova depends on none of them

### Errors

- `HttpError` class + 16 named factories
- `app.onError(handler)` global hook
- Spec-compliant `expose` policy (5xx hides the message by default)

### Plugins

- `app.register(plugin)` for boot-time configuration
- `app.onClose(handler)` LIFO cleanup
- First-party: CORS, rate-limit

### OpenAPI

- Auto-generated 3.1 document from `app.routes()`
- Per-status response schemas + route metadata (tags, summary, deprecated)
- One-line Swagger UI mount (assets via CDN)

## Examples

Runnable demos in [`examples/`](./examples/):

| Example                                        | What it shows                                               |
| ---------------------------------------------- | ----------------------------------------------------------- |
| [hello-world](./examples/hello-world/)         | The smallest possible Nova app.                             |
| [with-params](./examples/with-params/)         | Route parameters and automatic `ctx.params` typing.         |
| [with-query](./examples/with-query/)           | Query-string parsing via `ctx.query`.                       |
| [with-middleware](./examples/with-middleware/) | Onion-style middleware: logging, timing, auth, recovery.    |
| [with-errors](./examples/with-errors/)         | `HttpError`, factories, custom body, and `app.onError`.     |
| [with-validation](./examples/with-validation/) | Body / query / params validation via Standard Schema (Zod). |
| [with-openapi](./examples/with-openapi/)       | Auto-generated OpenAPI 3.1 + Swagger UI.                    |

Each example is a runnable workspace package — `pnpm --filter @novats-examples/<name> start`.

## Monorepo layout

```
packages/
  core/        @novats/core        — server, application, context, errors, middleware
  router/      @novats/router      — route matching, trie, params
  validator/   @novats/validator   — Standard Schema v1 adapter
  plugins/     @novats/plugins     — cors, rate-limit
  openapi/     @novats/openapi     — OpenAPI 3.1 generator + Swagger UI
examples/      — runnable example apps (one per feature)
playground/    — internal scratchpad
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

## License

[MIT](./LICENSE)
