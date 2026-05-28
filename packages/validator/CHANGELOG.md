# Changelog

All notable changes to `@novajs/validator` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-27

Initial public release.

### Added

- `StandardSchemaV1` type definitions byte-compatible with the official
  [Standard Schema v1](https://standardschema.dev) spec.
- `validateStandard(schema, value)` helper returning a discriminated
  outcome (`{ ok: true; value } | { ok: false; issues }`). Awaits both
  sync and async validator implementations uniformly.
- Zero runtime dependencies — the package only exposes the contract Nova
  uses to talk to user-supplied validators.
