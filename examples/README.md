# Examples

Runnable Nova applications that demonstrate one concept each. Each example is
a real pnpm workspace package — install once at the repo root and run by name.

```bash
pnpm install
pnpm --filter @novats-examples/hello-world start
```

## Index

| Example                               | What it shows                                                |
| ------------------------------------- | ------------------------------------------------------------ |
| [hello-world](./hello-world/)         | The smallest possible Nova app.                              |
| [with-params](./with-params/)         | Route parameters and automatic `ctx.params` typing.          |
| [with-query](./with-query/)           | Query-string parsing via `ctx.query` (lazy, pollution-safe). |
| [with-middleware](./with-middleware/) | Onion-style middleware: logging, timing, auth, recovery.     |
| [with-errors](./with-errors/)         | `HttpError`, factories, custom body, and `app.onError`.      |
| [with-validation](./with-validation/) | Body validation via Standard Schema (Zod + hand-rolled).     |
| [with-openapi](./with-openapi/)       | Auto-generated OpenAPI 3.1 from Nova routes + Zod schemas.   |
