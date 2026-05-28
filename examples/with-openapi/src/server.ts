/**
 * Auto-generated OpenAPI 3.1 from Nova routes + Zod schemas.
 *
 * Demonstrates the v0.5 surface end-to-end:
 *   • input schemas (body / query / params) — same as v0.3 validation
 *   • response schemas — documentation-only in v0.5
 *   • per-route metadata (summary, description, tags, deprecated)
 *   • operationId override
 *   • Swagger UI mounted at /docs (assets via CDN)
 *
 * Nova does not depend on Zod. The integration point is the
 * `schemaConverter` function — Zod (≥ 3.24), Valibot, ArkType all plug in
 * via their own JSON-Schema bridge.
 */
import { Nova } from "@novats/core";
import { openapi, type SchemaConverter } from "@novats/openapi";
import type { StandardSchemaV1 } from "@novats/validator";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const zodConverter: SchemaConverter = (schema: StandardSchemaV1): unknown =>
  zodToJsonSchema(schema as unknown as z.ZodTypeAny, { target: "openApi3" });

const app = new Nova();

// ─── /health — minimal route, no schemas ────────────────────────────────
app.get(
  "/health",
  {
    openapi: {
      summary: "Liveness probe",
      tags: ["meta"],
    },
    responses: {
      200: z.object({ ok: z.literal(true) }),
    },
  },
  () => ({ ok: true as const }),
);

// ─── /posts/:id — params coercion + typed response ──────────────────────
const Post = z.object({
  id: z.number().int().positive(),
  title: z.string(),
});

app.get(
  "/posts/:id",
  {
    params: z.object({ id: z.coerce.number().int().positive() }),
    responses: {
      200: Post,
      404: z.object({ error: z.string(), message: z.string().optional() }),
    },
    openapi: {
      summary: "Fetch a post by id",
      description: "Returns a single post or 404 if it does not exist.",
      tags: ["posts"],
    },
  },
  (ctx) => ({
    id: ctx.params.id,
    title: `Post ${ctx.params.id}`,
  }),
);

// ─── /search — query schema + custom operationId ────────────────────────
app.get(
  "/search",
  {
    query: z.object({
      q: z.string().min(1),
      page: z.coerce.number().int().min(1).default(1),
    }),
    responses: {
      200: z.object({
        q: z.string(),
        page: z.number().int(),
        results: z.array(Post),
      }),
    },
    openapi: {
      operationId: "searchPosts",
      summary: "Full-text search across posts",
      tags: ["search"],
    },
  },
  (ctx) => ({
    q: ctx.query.q,
    page: ctx.query.page,
    results: [],
  }),
);

// ─── /users — body validation + deprecated marker ───────────────────────
const CreateUser = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0),
  email: z.string().email().optional(),
});

app.post(
  "/users",
  {
    body: CreateUser,
    responses: {
      201: z.object({ user: CreateUser.extend({ id: z.string().uuid() }) }),
      422: z.object({
        error: z.literal("Unprocessable Entity"),
        issues: z.array(z.unknown()),
      }),
    },
    openapi: {
      summary: "Create a user",
      tags: ["users"],
    },
  },
  (ctx) => ({ user: { id: crypto.randomUUID(), ...ctx.body } }),
);

// A deprecated v1 endpoint — appears greyed out in Swagger UI.
app.post(
  "/v1/users",
  {
    body: CreateUser,
    openapi: {
      summary: "[Deprecated] Create a user (v1)",
      description: "Use `POST /users` instead.",
      tags: ["users"],
      deprecated: true,
    },
  },
  (ctx) => ({ user: { id: crypto.randomUUID(), ...ctx.body } }),
);

// ─── Mount the OpenAPI plugin ───────────────────────────────────────────
await app.register(
  openapi({
    info: {
      title: "Nova demo API",
      version: "1.0.0",
      description: "End-to-end example: routes + Zod schemas → OpenAPI 3.1 + Swagger UI.",
    },
    servers: [{ url: "http://127.0.0.1:3000" }],
    schemaConverter: zodConverter,
    ui: { title: "Nova demo API — Swagger UI" },
  }),
);

const { port } = await app.listen(3000);
console.log(`with-openapi example listening on http://127.0.0.1:${port}\n`);
console.log("Try:");
console.log(`  curl -s http://127.0.0.1:${port}/openapi.json | jq .`);
console.log(`  open http://127.0.0.1:${port}/docs        # Swagger UI in your browser`);
