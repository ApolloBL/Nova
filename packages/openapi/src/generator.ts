/**
 * Pure OpenAPI 3.1 document generator. Stateless — given a route snapshot
 * and options, returns a fresh document. Caching belongs in the plugin.
 */
import { STATUS_NAMES, type RegisteredRoute } from "@novats/core";
import type { StandardSchemaV1 } from "@novats/validator";
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  SchemaConverter,
} from "./types.js";

/**
 * Builds an OpenAPI 3.1 document from a list of registered routes.
 * Deterministic; the only side effect is a one-time warning via `warn`
 * when `schemaConverter` is omitted.
 */
export function generateOpenApiDocument(
  routes: readonly RegisteredRoute[],
  options: OpenApiOptions,
  warn: (msg: string) => void = noopWarn,
): OpenApiDocument {
  const converter = options.schemaConverter ?? buildFallbackConverter(warn);
  const paths: Record<string, OpenApiPathItem> = {};

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const operation = buildOperation(route, converter);

    const existing = paths[openApiPath] ?? {};
    paths[openApiPath] = {
      ...existing,
      [route.method.toLowerCase()]: operation,
    };
  }

  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers !== undefined ? { servers: options.servers } : {}),
    paths,
  };

  return document;
}

/**
 * Converts a Nova path pattern to OpenAPI form: `/users/:id` →
 * `/users/{id}`. Optional `:id?` is emitted as required — OpenAPI does
 * not model optional path params.
 */
export function toOpenApiPath(novaPath: string): string {
  // `?` first so we strip it before the plain replacement.
  return novaPath
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)\?/g, "{$1}")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

/**
 * Generates an operationId from method + path:
 * `${verb}${PascalCasedPath}`, with parameters mapped to `By${Name}`.
 *
 * - `GET /users`              → `getUsers`
 * - `GET /users/:id`          → `getUsersById`
 * - `POST /users/:userId/posts` → `postUsersByUserIdPosts`
 * - `GET /`                   → `getRoot`
 */
export function toOperationId(method: string, novaPath: string): string {
  const verb = method.toLowerCase();
  const segments = novaPath.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) return `${verb}Root`;

  const tail = segments
    .map((s) => {
      if (s.startsWith(":")) {
        const stripped = s.endsWith("?") ? s.slice(1, -1) : s.slice(1);
        return `By${capitalize(stripped)}`;
      }
      return capitalize(s);
    })
    .join("");

  return `${verb}${tail}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildOperation(route: RegisteredRoute, converter: SchemaConverter): OpenApiOperation {
  const parameters: OpenApiParameter[] = [];

  // Path parameters: use the converted params schema when present, else string.
  const pathParamNames = extractPathParamNames(route.path);
  if (pathParamNames.length > 0) {
    const paramsSchema =
      route.schemas?.params !== undefined ? converter(route.schemas.params) : undefined;
    const properties = isObjectWithProperties(paramsSchema) ? paramsSchema.properties : undefined;

    for (const name of pathParamNames) {
      const schema =
        properties !== undefined && name in properties ? properties[name] : { type: "string" };
      parameters.push({
        name,
        in: "path",
        required: true,
        schema,
      });
    }
  }

  // Query parameters: each top-level property → one `in: query` entry.
  if (route.schemas?.query !== undefined) {
    const querySchema = converter(route.schemas.query);
    if (isObjectWithProperties(querySchema)) {
      const required = Array.isArray(querySchema.required) ? querySchema.required : [];
      for (const [name, schema] of Object.entries(querySchema.properties)) {
        parameters.push({
          name,
          in: "query",
          required: required.includes(name),
          schema,
        });
      }
    }
  }

  let requestBody: OpenApiRequestBody | undefined;
  if (route.schemas?.body !== undefined) {
    requestBody = {
      required: true,
      content: {
        "application/json": { schema: converter(route.schemas.body) },
      },
    };
  }

  const meta = route.schemas?.openapi;
  const operationId = meta?.operationId ?? toOperationId(route.method, route.path);

  const operation: OpenApiOperation = {
    operationId,
    ...(meta?.summary !== undefined ? { summary: meta.summary } : {}),
    ...(meta?.description !== undefined ? { description: meta.description } : {}),
    ...(meta?.tags !== undefined && meta.tags.length > 0 ? { tags: meta.tags } : {}),
    ...(meta?.deprecated === true ? { deprecated: true } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
    responses: buildResponses(route, converter),
  };

  return operation;
}

/**
 * Builds the `responses` object. When the route declares response
 * schemas, each status code maps to a converted schema + a description
 * from {@link STATUS_NAMES}. Otherwise: `200: { description: "OK" }`.
 */
function buildResponses(
  route: RegisteredRoute,
  converter: SchemaConverter,
): Record<string, OpenApiResponse> {
  const responses = route.schemas?.responses;
  if (responses === undefined) {
    return { "200": { description: "OK" } };
  }

  const out: Record<string, OpenApiResponse> = {};
  for (const [codeStr, schema] of Object.entries(responses)) {
    const code = Number(codeStr);
    out[codeStr] = {
      description: STATUS_NAMES[code] ?? "Response",
      content: {
        "application/json": { schema: converter(schema) },
      },
    };
  }
  return out;
}

function extractPathParamNames(path: string): string[] {
  const names: string[] = [];
  const re = /:([A-Za-z_][A-Za-z0-9_]*)\??/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) names.push(m[1]);
  }
  return names;
}

function isObjectWithProperties(
  value: unknown,
): value is { properties: Record<string, unknown>; required?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "properties" in value &&
    typeof (value as { properties: unknown }).properties === "object" &&
    (value as { properties: unknown }).properties !== null
  );
}

let warnedNoConverter = false;
function buildFallbackConverter(warn: (msg: string) => void): SchemaConverter {
  return (_schema: StandardSchemaV1): unknown => {
    if (!warnedNoConverter) {
      warnedNoConverter = true;
      warn(
        "[nova/openapi] No `schemaConverter` configured — schemas will be " +
          "emitted as `{}`. Pass `schemaConverter` in the openapi() options " +
          "(see README for Zod/Valibot/ArkType bridges).",
      );
    }
    return {};
  };
}

/** Resets the one-time `schemaConverter`-missing warning state. */
export function _resetWarningStateForTests(): void {
  warnedNoConverter = false;
}

function noopWarn(_msg: string): void {
  // Default no-op so the generator stays pure when used directly.
}
