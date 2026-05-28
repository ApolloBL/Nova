# with-params

Demonstrates Nova's route parameters and automatic `ctx.params` typing.

## Run

```bash
pnpm install
pnpm --filter @novats-examples/with-params start
```

```bash
curl http://127.0.0.1:3000/users/me
# {"kind":"static","who":"the current user"}

curl http://127.0.0.1:3000/users/42
# {"kind":"param","id":"42"}

curl http://127.0.0.1:3000/users/7/posts/13
# {"userId":"7","postId":"13"}

curl http://127.0.0.1:3000/files
# {"kind":"index"}

curl http://127.0.0.1:3000/files/report.pdf
# {"kind":"file","name":"report.pdf"}
```

## What it shows

- `app.get("/users/:id", ...)` infers `ctx.params.id: string` from the literal
  path. No `as`, no manual generic, no type annotation.
- Multiple params (`/users/:userId/posts/:postId`) produce a typed `params`
  object with every placeholder as a key.
- Optional params (`:name?`) widen the type to `string | undefined`.
- A static route (`/users/me`) wins over a parametric one (`/users/:id`)
  when the literal request matches both — this is enforced at the matcher
  level, no priority configuration required.
