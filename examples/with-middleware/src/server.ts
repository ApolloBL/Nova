/**
 * Middleware in Nova.
 *
 * Demonstrates the canonical patterns:
 *   1. Request logging (before + after, around the chain).
 *   2. Response timing (sets `x-elapsed-ms` after the handler completes).
 *   3. Error recovery (turns downstream throws into a JSON 502).
 *   4. Auth guard (short-circuits with 401 when missing).
 *   5. ctx.state to carry per-request data between middleware.
 *
 * Module augmentation gives `ctx.state.requestId` a real type — uncomment
 * the relevant lines in your own code to do the same.
 */
import { randomUUID } from "node:crypto";
import { Nova } from "@novats/core";

// --- Typed ctx.state via module augmentation -------------------------------
//
// Uncomment to give `ctx.state.requestId` type `string`. The runtime behavior
// is identical either way; this is purely for editor/typecheck ergonomics.
//
// declare module "@novats/core" {
//   interface ContextState {
//     readonly requestId?: string;
//   }
// }

const app = new Nova();

// 1. Logger: prints a line on the way in and another on the way out.
app.use(async (ctx, next) => {
  const id = randomUUID().slice(0, 8);
  ctx.state["requestId"] = id;
  console.log(`[${id}] > ${ctx.method} ${ctx.path}`);
  await next();
  console.log(`[${id}] < ${ctx.method} ${ctx.path} (${ctx.raw.res.statusCode})`);
});

// 2. Timing: stamps an `x-elapsed-ms` header on every response, including
//    short-circuited ones (auth 401), because we are upstream of auth.
//
//    We use `ctx.header()` rather than `ctx.raw.res.setHeader()` because
//    Nova buffers the response until the chain finishes — `ctx.header()` is
//    the contract that respects this deferred-flush model and remains valid
//    in after-phase code.
app.use(async (ctx, next) => {
  const t0 = process.hrtime.bigint();
  await next();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ctx.header("x-elapsed-ms", ms.toFixed(2));
});

// 3. Error recovery: turn unexpected downstream throws into a clean 502.
//    Downstream of timing so timing still sees the wall time.
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (!ctx.sent) {
      ctx.status(502).json({
        error: "Upstream failure",
        requestId: ctx.state["requestId"],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

// 4. Auth: requires an `authorization` header for any route starting with `/admin`.
app.use((ctx, next) => {
  if (ctx.path.startsWith("/admin")) {
    const auth = ctx.raw.req.headers["authorization"];
    if (auth !== "Bearer letmein") {
      ctx.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  return next();
});

// Routes.
app.get("/", (ctx) => ({ hello: "world", requestId: ctx.state["requestId"] }));

app.get("/slow", async () => {
  await new Promise((r) => setTimeout(r, 50));
  return { slow: true };
});

app.get("/admin/secret", () => ({ flag: "CTF{onion-routes}" }));

app.get("/boom", () => {
  throw new Error("kaboom");
});

const { port } = await app.listen(3000);
console.log(`with-middleware example listening on http://127.0.0.1:${port}\n`);
console.log("Try:");
console.log(`  curl -i http://127.0.0.1:${port}/`);
console.log(`  curl -i http://127.0.0.1:${port}/slow`);
console.log(`  curl -i http://127.0.0.1:${port}/admin/secret           # 401`);
console.log(`  curl -i -H "Authorization: Bearer letmein" http://127.0.0.1:${port}/admin/secret`);
console.log(`  curl -i http://127.0.0.1:${port}/boom                   # 502 via recovery mw`);
