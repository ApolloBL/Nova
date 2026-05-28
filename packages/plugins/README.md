# @novats/plugins

First-party plugins for the [Nova](../../README.md) framework.

> 🚧 Pre-release. Public API is not stable yet.

Each plugin is a function that takes options and returns a Nova `Plugin`,
ready to pass to `app.register(...)`.

## Install

```bash
pnpm add @novats/core @novats/plugins
```

`@novats/plugins` declares `@novats/core` as a peer dependency. Install both —
they share the same Nova instance.

## Plugins shipped

| Plugin                    | Status | Notes                                              |
| ------------------------- | ------ | -------------------------------------------------- |
| [`cors`](#cors)           | ✅     | Cross-Origin Resource Sharing per the Fetch spec.  |
| [`rateLimit`](#ratelimit) | ✅     | Fixed-window in-memory; pluggable store for Redis. |

## `cors`

```ts
import { Nova } from "@novats/core";
import { cors } from "@novats/plugins";

const app = new Nova();

// Wide-open default
await app.register(cors());

// Concrete origin
await app.register(cors({ origin: "https://app.example.com" }));

// Multiple allowed origins
await app.register(cors({ origin: ["https://a.example.com", "https://b.example.com"] }));

// Pattern match
await app.register(cors({ origin: /\.example\.com$/ }));

// Dynamic (sync or async)
await app.register(
  cors({
    origin: async (origin) => await isOriginAllowed(origin),
    credentials: true,
  }),
);
```

### Options

| Option           | Type                                                                             | Default          | Notes                                                              |
| ---------------- | -------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `origin`         | `"*" \| string \| string[] \| RegExp \| (origin) => boolean \| Promise<boolean>` | `"*"`            | Combining `"*"` with `credentials: true` throws — spec violation.  |
| `methods`        | `string[]`                                                                       | standard 6       | `GET, HEAD, PUT, PATCH, POST, DELETE`.                             |
| `allowedHeaders` | `string[]`                                                                       | reflect request  | When unset, the preflight echoes `Access-Control-Request-Headers`. |
| `exposedHeaders` | `string[]`                                                                       | none             | Sets `Access-Control-Expose-Headers` on regular responses.         |
| `credentials`    | `boolean`                                                                        | `false`          | Adds `Access-Control-Allow-Credentials: true`.                     |
| `maxAge`         | `number` (seconds)                                                               | unset (no cache) | `Access-Control-Max-Age` preflight cache duration.                 |

### Behavior

- Requests **without** an `Origin` header are treated as same-origin and
  pass through with no CORS headers.
- Requests whose origin is **denied** also pass through with no CORS headers.
  The browser blocks the response client-side; the server does not leak the
  acceptance list via a `403`.
- An **OPTIONS** request that carries `Access-Control-Request-Method` is a
  preflight and is fully handled by the plugin (204, no downstream handler).
- A regular cross-origin request gets the appropriate headers attached and
  is forwarded to the next middleware / handler.

### `Vary` header

CORS responses that depend on the request's `Origin` (or
`Access-Control-Request-Headers` in preflights) need to advertise that
dependency via `Vary` so HTTP caches do not serve a stale response to a
different origin. The plugin **appends** to any existing `Vary` value an
upstream middleware may have set.

## `rateLimit`

Fixed-window rate limiting. Counts requests per "key" (default: client IP)
inside a window of `windowMs` milliseconds. The `(N+1)`-th request inside
the window is rejected with `429`.

```ts
import { Nova } from "@novats/core";
import { rateLimit } from "@novats/plugins";

const app = new Nova();

// 100 requests per minute, per IP
await app.register(rateLimit({ max: 100, windowMs: 60_000 }));

// Different limits for different paths — register multiple instances on
// dedicated routers, or use a custom keyGenerator that incorporates the path.
```

### Options

| Option         | Type                                   | Default                | Notes                                                                               |
| -------------- | -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `max`          | `number`                               | (required)             | Requests allowed per window, inclusive. Must be positive.                           |
| `windowMs`     | `number`                               | (required)             | Window duration in milliseconds. Must be positive.                                  |
| `keyGenerator` | `(ctx) => string`                      | `socket.remoteAddress` | Customize when behind a proxy / CDN — read `X-Forwarded-For` after validating it.   |
| `message`      | `string`                               | `"Too Many Requests"`  | Sent as `{ "error": message }` on rejection.                                        |
| `status`       | `number`                               | `429`                  | Status code for rejection.                                                          |
| `headers`      | `boolean`                              | `true`                 | Emit `RateLimit-Limit / -Remaining / -Reset` (and `Retry-After` on 429).            |
| `skip`         | `(ctx) => boolean \| Promise<boolean>` | `undefined`            | Return `true` to bypass rate limiting for a request.                                |
| `onLimit`      | `(ctx) => void \| Promise<void>`       | `undefined`            | Fire-and-forget hook invoked when a request is rejected. Errors logged, not thrown. |
| `store`        | `RateLimitStore`                       | in-memory              | Swap for Redis/Memcached by implementing the interface.                             |

### Headers

The plugin emits the [IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
`RateLimit-*` fields (no `X-` prefix):

| Header                | Where          | Meaning                                       |
| --------------------- | -------------- | --------------------------------------------- |
| `RateLimit-Limit`     | every response | The `max` configured.                         |
| `RateLimit-Remaining` | every response | Remaining quota in the active window.         |
| `RateLimit-Reset`     | every response | Seconds until the active window resets.       |
| `Retry-After`         | only on `429`  | Same value as `RateLimit-Reset` at rejection. |

Set `headers: false` to suppress all of them (e.g. when fronted by an API
gateway that already adds them).

### Behind a proxy / CDN

The default `keyGenerator` uses `socket.remoteAddress` which, behind a
reverse proxy, will be the proxy itself — collapsing all clients to one
counter. Pass a custom `keyGenerator` that reads a forwarded header **only
after validating the proxy chain**:

```ts
rateLimit({
  max: 100,
  windowMs: 60_000,
  keyGenerator: (ctx) => {
    const fwd = ctx.raw.req.headers["x-forwarded-for"];
    return typeof fwd === "string" ? fwd.split(",")[0].trim() : "unknown";
  },
});
```

### Custom store (Redis et al.)

Implement the `RateLimitStore` interface and pass it via `store`:

```ts
import type { RateLimitStore } from "@novats/plugins";

class RedisRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number) {
    // INCR + EXPIRE in a pipeline, return current count + TTL → resetAt
  }
}

await app.register(rateLimit({ max: 100, windowMs: 60_000, store: new RedisRateLimitStore() }));
```

The default in-memory store is fine for single-process apps. For multi-instance
deployments where rate limits must be shared, a Redis (or similar) backend is
required — counters in one process are invisible to the others.
