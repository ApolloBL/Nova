# with-middleware

Demonstrates the canonical middleware patterns: logging, timing, error
recovery, and auth — all composed in the onion model.

## Run

```bash
pnpm install
pnpm --filter @novajs-examples/with-middleware start
```

```bash
curl -i http://127.0.0.1:3000/
# 200, x-elapsed-ms set, request id in body, server log shows in/out lines.

curl -i http://127.0.0.1:3000/admin/secret
# 401 (auth short-circuits), x-elapsed-ms still set (timing is upstream of auth).

curl -i -H "Authorization: Bearer letmein" http://127.0.0.1:3000/admin/secret
# 200

curl -i http://127.0.0.1:3000/boom
# 502 with a custom JSON body — the recovery middleware caught the throw.
```

## Onion order (this app)

```
logger  →  timing  →  recovery  →  auth  →  handler
                                            ↓
logger  ←  timing  ←  recovery  ←  auth  ←  handler
```

When `auth` short-circuits (no `next()`), the chain unwinds at that point:
`recovery`, `timing`, and `logger` all complete their after-phases normally,
but `handler` never runs.

When the handler throws (`/boom`), the rejection bubbles up through
`auth`'s `return next()` — `auth` does not catch it — and lands in
`recovery`'s `try { await next() } catch { ... }`. The recovery middleware
synthesizes a 502 and the chain finishes normally.

## Patterns shown

| Pattern               | Where                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Request logging       | First middleware, wraps the whole chain                            |
| Response timing       | Second middleware, sets header in after-phase                      |
| Error recovery        | Third middleware, `try { await next() } catch`                     |
| Auth guard            | Fourth middleware, short-circuits with 401                         |
| Per-request state     | `ctx.state["requestId"]`                                           |
| Typed state (preview) | `declare module "@novajs/core" { interface ContextState { ... } }` |

## Typed `ctx.state`

Uncomment the `declare module` block in `src/server.ts` to give
`ctx.state.requestId` the static type `string | undefined` instead of
`unknown`.
