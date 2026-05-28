/**
 * End-to-end validation in Nova using Zod.
 *
 * Three input sources are validated independently, each via the Standard
 * Schema v1 contract:
 *
 *   • `body`   — JSON request body
 *   • `query`  — URL query string
 *   • `params` — route placeholders (`:id`, `:slug`, …)
 *
 * Validation runs before the handler. Issues from every source are
 * aggregated into a single `422` response.
 *
 * Nova does not depend on Zod. Zod (≥ 3.24) implements Standard Schema
 * natively, so this code works as-is with any other validator that adopts
 * the spec — swap `z.object(...)` for `v.object(...)` (Valibot) or
 * `type({...})` (ArkType) and the rest stays the same.
 */
import { Nova, type StandardSchemaV1 } from "@novajs/core";
import { z } from "zod";

const app = new Nova();

// ─── Body validation: POST /users ────────────────────────────────────────
const CreateUser = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(150),
  email: z.string().email().optional(),
});

app.post("/users", { body: CreateUser }, (ctx) => {
  // ctx.body is { name: string; age: number; email?: string } — fully typed.
  return { user: { id: crypto.randomUUID(), ...ctx.body } };
});

// ─── Params coercion: GET /posts/:id ─────────────────────────────────────
// Zod's `coerce` namespace converts the string segment from the URL into a
// real number. `ctx.params.id` becomes `number`, not `string`.
const PostParams = z.object({ id: z.coerce.number().int().positive() });

app.get("/posts/:id", { params: PostParams }, (ctx) => {
  return { post: { id: ctx.params.id, type: typeof ctx.params.id } };
});

// ─── Query validation: GET /search ───────────────────────────────────────
const SearchQuery = z.object({
  q: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

app.get("/search", { query: SearchQuery }, (ctx) => {
  // ctx.query is { q: string; page: number; per_page: number } — defaults
  // applied, coercions applied, narrowed types.
  return { query: ctx.query };
});

// ─── All three together: POST /items/:itemId?dry_run=… ───────────────────
const ItemParams = z.object({ itemId: z.coerce.number().int() });
const ItemQuery = z.object({
  dry_run: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
const ItemBody = z.object({
  quantity: z.number().int().min(1),
  note: z.string().optional(),
});

app.post("/items/:itemId", { params: ItemParams, query: ItemQuery, body: ItemBody }, (ctx) => ({
  itemId: ctx.params.itemId, // number
  dryRun: ctx.query.dry_run, // boolean
  payload: ctx.body, // { quantity: number; note?: string }
}));

// ─── A hand-rolled Standard Schema (no Zod). ─────────────────────────────
const EchoText: StandardSchemaV1<unknown, { text: string }> = {
  "~standard": {
    version: 1,
    vendor: "with-validation-example",
    validate: (value) => {
      if (typeof value !== "object" || value === null) {
        return { issues: [{ message: "Expected object" }] };
      }
      const v = value as Record<string, unknown>;
      if (typeof v["text"] !== "string") {
        return { issues: [{ message: "Expected string", path: ["text"] }] };
      }
      return { value: { text: v["text"] } };
    },
  },
};

app.post("/echo", { body: EchoText }, (ctx) => ({ echo: ctx.body.text.toUpperCase() }));

const { port } = await app.listen(3000);
console.log(`with-validation example listening on http://127.0.0.1:${port}\n`);
console.log("Try:");
console.log(
  `  curl -i -X POST -H "content-type: application/json" \\\n` +
    `       -d '{"name":"Ada","age":28}' http://127.0.0.1:${port}/users`,
);
console.log(`  curl -i http://127.0.0.1:${port}/posts/42`);
console.log(`  curl -i http://127.0.0.1:${port}/posts/abc                  # 422`);
console.log(`  curl -i "http://127.0.0.1:${port}/search?q=nova&page=2"`);
console.log(`  curl -i "http://127.0.0.1:${port}/search"                    # 422`);
console.log(
  `  curl -i -X POST -H "content-type: application/json" \\\n` +
    `       -d '{"quantity":3}' "http://127.0.0.1:${port}/items/77?dry_run=true"`,
);
console.log(
  `  curl -i -X POST -H "content-type: application/json" \\\n` +
    `       -d '{"text":"hello"}' http://127.0.0.1:${port}/echo`,
);
