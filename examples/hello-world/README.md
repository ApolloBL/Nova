# hello-world

The smallest possible Nova app. If this works on your machine, the framework
is wired up correctly.

## Run

```bash
pnpm install
pnpm --filter @novajs-examples/hello-world start
```

Then in another terminal:

```bash
curl http://127.0.0.1:3000/
# {"hello":"world"}
```

## What it shows

- `new Nova()` creates an application.
- `app.get(path, handler)` registers a route.
- Returning a plain object auto-serializes to JSON with
  `Content-Type: application/json`.
- `app.listen(port)` resolves once the server is bound; the returned object
  exposes the resolved `port` and a `close()` helper.
