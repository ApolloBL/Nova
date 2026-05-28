# @novats/openapi

Automatic OpenAPI 3.1 specification generator for Nova applications.

> 🚧 Pre-release. Public API is not stable yet.

The plugin reads `app.routes()` and emits a fresh OpenAPI 3.1 JSON document
on every request to the configured mount path. Schemas attached to routes
(`body`, `query`, `params`, `responses`) are translated to JSON Schema via a
**vendor-supplied bridge** — Nova stays free of any direct validator
dependency.

## Install

```bash
pnpm add @novats/core @novats/openapi
```

## Quick start (with Zod)

```ts
import { Nova } from "@novats/core";
import { openapi, type SchemaConverter } from "@novats/openapi";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const zodConverter: SchemaConverter = (s) =>
  zodToJsonSchema(s as unknown as z.ZodTypeAny, { target: "openApi3" });

const app = new Nova();

app.post("/users", { body: z.object({ name: z.string() }) }, (ctx) => ctx.body);

await app.register(
  openapi({
    info: { title: "My API", version: "1.0.0" },
    schemaConverter: zodConverter,
    ui: {}, // mounts Swagger UI at /docs
  }),
);

await app.listen(3000);
// curl http://127.0.0.1:3000/openapi.json
// open http://127.0.0.1:3000/docs
```

## Options

| Option            | Type                                               | Default           | Notes                                                     |
| ----------------- | -------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| `info`            | `{ title: string; version: string; description? }` | (required)        | OpenAPI's required `info` block.                          |
| `servers`         | `{ url: string; description? }[]`                  | unset             | Server entries listed in the document.                    |
| `path`            | `string`                                           | `"/openapi.json"` | Where the JSON document is served.                        |
| `schemaConverter` | `(schema: StandardSchemaV1) => unknown`            | none (warns once) | Translates a Standard Schema into a JSON Schema object.   |
| `ui`              | `{ path?: string; title?: string } \| undefined`   | unset             | When provided, mounts a Swagger UI page (assets via CDN). |

When `schemaConverter` is unset, every schema is emitted as `{}` and a
one-time `console.warn` is printed so the misconfiguration is visible.

## Per-route metadata

Add `responses` and `openapi` to any route's `RouteSchemas` to enrich its
operation:

```ts
app.get(
  "/posts/:id",
  {
    params: z.object({ id: z.coerce.number() }),
    responses: {
      200: Post,
      404: z.object({ error: z.string() }),
    },
    openapi: {
      summary: "Fetch a post by id",
      description: "Returns a single post or 404 if it does not exist.",
      tags: ["posts"],
      deprecated: false,
      operationId: "getPostById",
    },
  },
  (ctx) => repository.find(ctx.params.id),
);
```

| Field                 | Effect on the generated document                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `responses[N]`        | Per-status response schema. Description sourced from the canonical HTTP reason phrase (or `"Response"` for unknown codes). |
| `openapi.summary`     | Operation summary (shown as the title in Swagger UI).                                                                      |
| `openapi.description` | Long-form description (CommonMark in compatible viewers).                                                                  |
| `openapi.tags`        | Logical grouping (sidebar sections in Swagger UI).                                                                         |
| `openapi.deprecated`  | Marks the operation as deprecated (greyed out in UI).                                                                      |
| `openapi.operationId` | Override the auto-generated id.                                                                                            |

`responses` is **documentation-only** in v0.5 — handler return values are
not validated against the response schemas at runtime. Opt-in runtime
validation lands in v1.0+.

## Swagger UI

Pass a `ui` option to mount an interactive viewer:

```ts
await app.register(
  openapi({
    info: { title: "My API", version: "1.0.0" },
    schemaConverter: zodConverter,
    ui: { path: "/docs", title: "My API — Console" },
  }),
);
// open http://127.0.0.1:3000/docs in your browser
```

The mounted page is a single HTML document that loads
`swagger-ui-dist@5` from [unpkg](https://unpkg.com). No assets are bundled
with Nova; air-gapped deployments can register their own HTML route at the
same path instead.

The page title in the browser tab defaults to `info.title` and can be
overridden via `ui.title`. The value is HTML-escaped before injection so a
hostile config string cannot break out of the title.

## What is emitted

| Nova feature                                                                  | OpenAPI emission                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `app.get("/users/:id")`                                                       | `paths["/users/{id}"].get` with `operationId: "getUsersById"`                  |
| Path `:id`                                                                    | `parameters[].in: "path"`, `required: true`                                    |
| `:id?` optional                                                               | Same as required — OpenAPI lacks first-class optional path params              |
| `params` schema                                                               | Fills in per-name path-parameter schemas                                       |
| `query` schema                                                                | Each property → `parameters[].in: "query"`, `required` from schema             |
| `body` schema                                                                 | `requestBody.content["application/json"].schema`                               |
| `responses[N]` schema                                                         | `responses[N].content["application/json"].schema` with status-name description |
| `openapi.summary` / `.description` / `.tags` / `.deprecated` / `.operationId` | Direct mapping onto the OpenAPI Operation object                               |
| (no responses declared)                                                       | `responses["200"]: { description: "OK" }` fallback                             |

Components / `$ref` deduplication and security schemes are **not emitted**
in this release — they land in v0.5.C. Post-process the returned document
if you need them right now.

## Validator bridges

The `schemaConverter` is the integration point. Common choices:

| Validator  | Bridge                                                                |
| ---------- | --------------------------------------------------------------------- |
| Zod ≥ 3.24 | `import { toJSONSchema } from "zod"` (native) or `zod-to-json-schema` |
| Valibot    | `@valibot/to-json-schema` → `toJsonSchema(schema)`                    |
| ArkType    | `(s) => s.toJsonSchema()`                                             |

All three implement Standard Schema natively, so the surrounding code is the
same regardless of which one you pick.

## Pure generator API

For tests or non-HTTP use cases, the generator is exported directly:

```ts
import { generateOpenApiDocument } from "@novats/openapi";

const doc = generateOpenApiDocument(app.routes(), {
  info: { title: "T", version: "1" },
  schemaConverter,
});
```

The function is stateless — given the same inputs, it always returns the
same output (apart from a one-time warning when no converter is configured).
