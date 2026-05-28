# with-query

Demonstrates Nova's `ctx.query` — lazy query-string parsing with array support
for repeated keys.

## Run

```bash
pnpm install
pnpm --filter @novajs-examples/with-query start
```

```bash
curl "http://127.0.0.1:3000/search?q=hello&page=2"
# {"q":"hello","page":"2"}

curl "http://127.0.0.1:3000/filter?ids=1&ids=2&ids=3"
# {"ids":["1","2","3"]}

curl "http://127.0.0.1:3000/echo?msg=hello%20world&tag=urgent"
# {"msg":"hello world","tag":"urgent"}

curl "http://127.0.0.1:3000/echo?__proto__=ignored&safe=ok"
# {"safe":"ok"}        ← __proto__ silently dropped
```

## What it shows

- **Single value:** `?q=hello` → `ctx.query.q === "hello"`.
- **Repeated key:** `?ids=1&ids=2&ids=3` → `ctx.query.ids === ["1", "2", "3"]`.
- **Absent key:** `ctx.query.missing === undefined`.
- **URL decoding:** `%20` and `+` both decode to a space.
- **Prototype-pollution safety:** keys `__proto__`, `constructor`, and
  `prototype` are silently dropped. The result object has a `null` prototype.
- **Laziness:** the parse runs once per request, at the moment a handler
  first reads `ctx.query`. Handlers that don't read it pay nothing.

## Type at the call site

```ts
ctx.query.ids;
// type: string | readonly string[] | undefined
```

Strict typing of the query shape lands in v0.3 via `@novajs/validator`:

```ts
// preview, not yet implemented:
app.get("/filter", { query: z.object({ ids: z.array(z.string()) }) }, (ctx) => {
  ctx.query.ids; // string[] — already validated
});
```
