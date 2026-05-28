import type { StandardSchemaV1 } from "@novats/validator";

/**
 * Translates a Standard Schema into JSON Schema (loose 2020-12 /
 * OpenAPI 3.1 dialect). The spec does not carry a runtime exporter, so
 * each validator ships its own bridge — wrap whichever you use:
 *
 * - **Zod ≥ 3.24** — `toJSONSchema` from `zod`.
 * - **Valibot** — `toJsonSchema` from `@valibot/to-json-schema`.
 * - **ArkType** — the `.toJsonSchema()` method on each type.
 */
export type SchemaConverter = (schema: StandardSchemaV1) => unknown;

/** OpenAPI `info` block — `title` and `version` are required by the spec. */
export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

/** Swagger UI mount options. When set, the plugin serves a CDN-backed UI page. */
export interface SwaggerUiOptions {
  /** Mount path. Defaults to `"/docs"`. */
  readonly path?: string;
  /** Browser-tab title. Defaults to {@link OpenApiInfo.title}. */
  readonly title?: string;
}

/** Options accepted by {@link openapi}. */
export interface OpenApiOptions {
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  /** JSON document mount path. Defaults to `/openapi.json`. */
  readonly path?: string;
  /**
   * Standard Schema → JSON Schema translator. When omitted, the generator
   * emits empty `{}` schemas and logs one warning.
   */
  readonly schemaConverter?: SchemaConverter;
  /**
   * Mounts Swagger UI when set. Assets are loaded from `unpkg.com`;
   * air-gapped deployments should mount their own HTML route instead.
   */
  readonly ui?: SwaggerUiOptions;
}

/**
 * Minimal OpenAPI 3.1 document shape this generator emits. Not exhaustive —
 * post-process the returned object to merge additional fields.
 */
export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly paths: Record<string, OpenApiPathItem>;
}

export interface OpenApiPathItem {
  readonly get?: OpenApiOperation;
  readonly head?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly put?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
  readonly delete?: OpenApiOperation;
  readonly options?: OpenApiOperation;
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: Record<string, OpenApiResponse>;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header" | "cookie";
  readonly required: boolean;
  readonly schema: unknown;
}

export interface OpenApiRequestBody {
  readonly required: boolean;
  readonly content: Record<string, { readonly schema: unknown }>;
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Record<string, { readonly schema: unknown }>;
}
