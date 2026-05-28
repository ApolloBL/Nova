/**
 * Query-string parsing in Nova.
 *
 * `ctx.query` is a frozen, null-prototype record. Repeated keys collapse to
 * arrays; absent keys are simply `undefined`. The parse is lazy: handlers
 * that never read `ctx.query` pay no cost.
 *
 * The type at the call site is
 *   `Readonly<Record<string, string | readonly string[]>>`
 * so every access is `string | readonly string[] | undefined` (because of
 * `noUncheckedIndexedAccess`). Strict validation of query shape arrives in
 * v0.3 alongside `@novats/validator`.
 */
import { Nova } from "@novats/core";

const app = new Nova();

// Single query value with a default.
app.get("/search", (ctx) => {
  const q = ctx.query["q"];
  const page = ctx.query["page"] ?? "1";
  return { q, page };
});

// Multi-value query: ?ids=1&ids=2&ids=3 → string[].
app.get("/filter", (ctx) => {
  const ids = ctx.query["ids"];
  // ids: string | readonly string[] | undefined
  if (ids === undefined) return { ids: [] };
  if (typeof ids === "string") return { ids: [ids] };
  return { ids };
});

// Echo the entire parsed query — useful to inspect decoding behavior.
app.get("/echo", (ctx) => ctx.query);

const { port } = await app.listen(3000);
console.log(`with-query example listening on http://127.0.0.1:${port}`);
console.log("Try:");
console.log(`  curl "http://127.0.0.1:${port}/search?q=hello&page=2"`);
console.log(`  curl "http://127.0.0.1:${port}/filter?ids=1&ids=2&ids=3"`);
console.log(`  curl "http://127.0.0.1:${port}/echo?msg=hello%20world&tag=urgent"`);
console.log(`  curl "http://127.0.0.1:${port}/echo?__proto__=ignored&safe=ok"`);
