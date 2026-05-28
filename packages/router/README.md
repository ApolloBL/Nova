# @novajs/router

Route matching for [Nova](../../README.md). Generic over the handler type so
it can be reused outside the framework.

> 🚧 Pre-release. Public API is not stable yet.

## Install

```bash
pnpm add @novajs/router
```

Most users never depend on this package directly — `@novajs/core` re-uses it
internally. It is published separately so other tools can build on top of the
same primitives.

## API (v0.1)

Exact-match matching only. Trie-based parameter routes land in v0.2.

```ts
import { Router } from "@novajs/router";

const router = new Router<() => string>();

router.add("GET", "/", () => "root");
router.add("GET", "/users", () => "list");
router.add("POST", "/users", () => "create");

router.find("GET", "/users");
//   ↳ { handler: [Function] }

router.find("GET", "/missing");
//   ↳ undefined
```

### `class Router<H>`

| Method                       | Behavior                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| `add(method, path, handler)` | Register a handler. Throws on duplicate `method` + `path`. |
| `find(method, path)`         | Lookup. Returns `{ handler }` or `undefined`.              |

### Semantics

- **Exact match.** `/foo` and `/foo/` are distinct paths.
- **Methods are uppercase.** The router does not normalize. The caller must.
- **Fail-fast on duplicates.** A repeated registration throws with a clear
  message — silent overwrite is a footgun.
- **Same path, different methods** is fine: `GET /users` and `POST /users`
  coexist without conflict.

### Types

```ts
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

interface RouteMatch<H> {
  readonly handler: H;
}
```

The `RouteMatch` object is intentional: v0.2 will add `params` next to
`handler` without changing the call signature.

## Roadmap

See the [root README](../../README.md#roadmap).
