# Changelog

All notable changes to `@novajs/router` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-27

Initial public release.

### Added

- `Router<H>` — generic over the stored handler type.
- Hybrid matcher: O(1) static map for non-parametric routes + per-method
  trie for parametric ones.
- Static-vs-parametric precedence: a literal request matches a static
  registration before its parametric sibling.
- Path syntax:
  - `/users` — literal segments
  - `/users/:id` — required parameter
  - `/users/:id?` — optional trailing parameter
- Parameter names are local to each route (not the trie node), so two
  routes can share a parametric prefix with different names.
- Fail-fast on duplicate registrations (`"Route already registered"`) and
  on structurally-equivalent conflicts (`"Route conflict"`).
- `Router.entries()` generator yielding `(method, path, value)` triples
  for introspection.
- `RouteMatch<H>` always includes a `params` object (frozen empty for
  static routes — never `undefined`).
