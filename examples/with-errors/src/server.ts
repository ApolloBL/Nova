/**
 * Structured error handling in Nova.
 *
 * Demonstrates:
 *   1. Throwing convenience factories (`notFound`, `badRequest`, ...).
 *   2. Constructing an `HttpError` directly for full control of headers,
 *      body shape, and expose policy.
 *   3. A custom `app.onError` handler that adds structured logging while
 *      delegating actual rendering to Nova's default policy.
 *   4. The 5xx-hidden vs 4xx-exposed message policy.
 */
import { randomUUID } from "node:crypto";
import { HttpError, Nova, badRequest, notFound, unauthorized } from "@novats/core";

const app = new Nova();

// --- onError: structured logging, then let Nova render the response -------
app.onError((err, ctx) => {
  const id = (ctx.state["requestId"] as string | undefined) ?? "-";
  if (err instanceof HttpError) {
    console.log(`[${id}] ${err.status} ${ctx.method} ${ctx.path} — ${err.message}`);
  } else {
    console.error(`[${id}] 500 ${ctx.method} ${ctx.path} — unhandled:`, err);
  }
  // No `ctx.json(...)` call → Nova applies its default rendering policy.
});

// --- request-id middleware so onError logs are correlatable ---------------
app.use(async (ctx, next) => {
  ctx.state["requestId"] = randomUUID().slice(0, 8);
  await next();
});

// --- routes ----------------------------------------------------------------

// Factory style: throws a 404 with an exposed message.
app.get("/users/:id", (ctx) => {
  const id = ctx.params.id;
  if (id === "0") throw notFound(`User ${id} not found`);
  if (Number.isNaN(Number(id))) throw badRequest("`id` must be numeric");
  return { id, name: `User ${id}` };
});

// Direct construction: 401 with a `WWW-Authenticate` header.
app.get("/admin/panel", () => {
  throw unauthorized("Bearer token required", {
    headers: { "WWW-Authenticate": 'Bearer realm="admin"' },
  });
});

// Custom body: the default `{ error, message }` shape is replaced wholesale.
app.get("/validate", () => {
  throw new HttpError(422, "validation failed", {
    body: {
      code: "VALIDATION_ERROR",
      details: [
        { field: "email", reason: "missing" },
        { field: "age", reason: "must be >= 18" },
      ],
    },
  });
});

// 5xx: by default, `message` is hidden from the client. The string below is
// only visible in the server logs (via onError), not in the response body.
app.get("/db", () => {
  throw new HttpError(503, "Connection refused at db://prod-1:5432");
});

// 5xx with explicit `expose: true` lets you communicate operational state.
app.get("/maintenance", () => {
  throw new HttpError(503, "Scheduled maintenance until 03:00 UTC", {
    expose: true,
    headers: { "Retry-After": "3600" },
  });
});

// Non-HttpError throws fall through to the generic 500.
app.get("/boom", () => {
  throw new Error("uncategorized");
});

const { port } = await app.listen(3000);
console.log(`with-errors example listening on http://127.0.0.1:${port}\n`);
console.log("Try:");
console.log(`  curl -i http://127.0.0.1:${port}/users/0          # 404 (factory)`);
console.log(`  curl -i http://127.0.0.1:${port}/users/abc        # 400`);
console.log(`  curl -i http://127.0.0.1:${port}/users/7          # 200`);
console.log(`  curl -i http://127.0.0.1:${port}/admin/panel      # 401 + WWW-Authenticate`);
console.log(`  curl -i http://127.0.0.1:${port}/validate         # 422 custom body`);
console.log(`  curl -i http://127.0.0.1:${port}/db               # 503 with message hidden`);
console.log(`  curl -i http://127.0.0.1:${port}/maintenance      # 503 with message exposed`);
console.log(`  curl -i http://127.0.0.1:${port}/boom             # 500 generic`);
