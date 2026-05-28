# with-validation

Body validation via [Standard Schema v1](https://standardschema.dev). Uses Zod
(≥ 3.24) for the realistic case and a hand-rolled schema to show the
underlying contract.

## Run

```bash
pnpm install
pnpm --filter @novajs-examples/with-validation start
```

```bash
# Happy path
curl -i -X POST -H "content-type: application/json" \
     -d '{"name":"Ada","age":28}' http://127.0.0.1:3000/users
# 200 + {"user":{"id":"…","name":"Ada","age":28}}

# Validation failure
curl -i -X POST -H "content-type: application/json" \
     -d '{"name":"","age":-1}' http://127.0.0.1:3000/users
# 422 + {"error":"Unprocessable Entity","issues":[...]}

# Hand-rolled schema
curl -i -X POST -H "content-type: application/json" \
     -d '{"text":"hello"}' http://127.0.0.1:3000/echo
# 200 + {"echo":"HELLO"}
```

## What it shows

| Feature                            | How                                            |
| ---------------------------------- | ---------------------------------------------- |
| Vendor-neutral validation contract | `StandardSchemaV1` from `@novajs/core`         |
| Zod integration                    | `z.object({...})` passed as `{ body: schema }` |
| Inferred body type                 | `ctx.body.*` typed from the Zod schema         |
| 4xx vs 4xx error categories        | 400 invalid JSON, 413 too large, 422 invalid   |
| Pluggable for other validators     | Same code works with Valibot, ArkType, etc.    |

## Why Standard Schema

Nova has **no dependency** on Zod (or any other validator). The framework
talks to the validator only through the `~standard` interface declared in
this example. If you prefer Valibot, replace `z.object(...)` with
`v.object(...)` and the rest of the code stays the same:

```ts
import * as v from "valibot";
const CreateUser = v.object({ name: v.string(), age: v.number() });
app.post("/users", { body: CreateUser }, (ctx) => ctx.body);
```
