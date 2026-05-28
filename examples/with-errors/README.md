# with-errors

Demonstrates structured error handling: `HttpError`, convenience factories,
and the `app.onError` hook.

## Run

```bash
pnpm install
pnpm --filter @novats-examples/with-errors start
```

```bash
curl -i http://127.0.0.1:3000/users/0
# HTTP/1.1 404 Not Found
# {"error":"Not Found","message":"User 0 not found"}

curl -i http://127.0.0.1:3000/admin/panel
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer realm="admin"
# {"error":"Unauthorized","message":"Bearer token required"}

curl -i http://127.0.0.1:3000/validate
# HTTP/1.1 422 Unprocessable Entity
# {"code":"VALIDATION_ERROR","details":[...]}   ← custom body, no `error`/`message`

curl -i http://127.0.0.1:3000/db
# HTTP/1.1 503 Service Unavailable
# {"error":"Service Unavailable"}               ← message HIDDEN (5xx default)

curl -i http://127.0.0.1:3000/maintenance
# HTTP/1.1 503 Service Unavailable
# Retry-After: 3600
# {"error":"Service Unavailable","message":"Scheduled maintenance until 03:00 UTC"}

curl -i http://127.0.0.1:3000/boom
# HTTP/1.1 500 Internal Server Error
# {"error":"Internal Server Error"}
```

## What it shows

| Pattern                              | Where                                                |
| ------------------------------------ | ---------------------------------------------------- |
| Convenience factories                | `notFound`, `badRequest`, `unauthorized` in handlers |
| Direct `HttpError` with options      | `/admin/panel` (custom headers)                      |
| Custom body shape                    | `/validate` (replaces the default `{error,message}`) |
| 5xx message hidden by default        | `/db`                                                |
| 5xx exposed with `{ expose: true }`  | `/maintenance`                                       |
| Generic 500 for non-HttpError throws | `/boom`                                              |
| Structured logging in `app.onError`  | All routes — see server console                      |

## Expose policy

- **4xx** errors expose their `message` by default (client correctable).
- **5xx** errors hide their `message` by default (may leak internals).
- Override per-error with `{ expose: true }` or `{ expose: false }`.

## `app.onError`

The hook in this example only **logs**; it deliberately does not call
`ctx.json(...)`. When the hook returns without writing a body, Nova falls
back to its default rendering policy. This pattern — "log and let Nova
render" — is the most common shape.

If you want full control, write the response inside `onError`:

```ts
app.onError((err, ctx) => {
  ctx.status(500).json({
    requestId: ctx.state["requestId"],
    error: err instanceof Error ? err.message : String(err),
  });
});
```

When `onError` writes the response, Nova's default rendering is skipped.
