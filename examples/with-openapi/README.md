# with-openapi

Auto-generated OpenAPI 3.1 specification from Nova routes + Zod schemas.

Nova does not depend on Zod — it talks to schemas through the Standard
Schema v1 contract. For OpenAPI emission you supply a `schemaConverter`
that turns a Standard Schema into a JSON Schema. This example uses
[`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema);
Valibot and ArkType have equivalent bridges.

## Run

```bash
pnpm install
pnpm --filter @novats-examples/with-openapi start
```

```bash
curl -s http://127.0.0.1:3000/openapi.json | jq .
```

You should see a complete OpenAPI 3.1 document with paths, parameters, and
request bodies derived from the registered routes and Zod schemas.

Drop the JSON into [Swagger Editor](https://editor.swagger.io) or any other
OpenAPI tool to see it rendered.

## What it shows

- `app.routes()` enumerates every registered route.
- The `openapi()` plugin builds an OpenAPI 3.1 document from those routes
  on each request to `/openapi.json` (default mount path; configurable).
- Path placeholders (`:id`) become OpenAPI braces (`{id}`).
- A `params` schema fills in the path-parameter schemas (otherwise they are
  emitted as `{ type: "string" }`).
- A `query` schema generates `in: query` parameters with `required` set
  from the schema's required list.
- A `body` schema becomes `requestBody.content["application/json"].schema`.

## Swap the validator

To use Valibot instead of Zod, change two lines:

```ts
import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";

const valibotConverter: SchemaConverter = (s) =>
  toJsonSchema(s as unknown as v.BaseSchema<unknown, unknown, never>);

// ...

await app.register(openapi({ info, schemaConverter: valibotConverter }));
```

Everything else stays the same — routes, handlers, plugin registration.
