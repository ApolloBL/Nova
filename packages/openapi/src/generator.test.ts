import type { RegisteredRoute } from "@novajs/core";
import type { StandardSchemaV1 } from "@novajs/validator";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetWarningStateForTests,
  generateOpenApiDocument,
  toOpenApiPath,
  toOperationId,
} from "./generator.js";

beforeEach(() => {
  _resetWarningStateForTests();
});

describe("toOpenApiPath", () => {
  it("leaves a static path untouched", () => {
    expect(toOpenApiPath("/users")).toBe("/users");
    expect(toOpenApiPath("/")).toBe("/");
  });

  it("converts `:param` to `{param}`", () => {
    expect(toOpenApiPath("/users/:id")).toBe("/users/{id}");
  });

  it("converts multiple parameters", () => {
    expect(toOpenApiPath("/users/:userId/posts/:postId")).toBe("/users/{userId}/posts/{postId}");
  });

  it("strips the trailing `?` from optional parameters", () => {
    expect(toOpenApiPath("/files/:name?")).toBe("/files/{name}");
  });
});

describe("toOperationId", () => {
  it("uses `Root` for the bare root path", () => {
    expect(toOperationId("GET", "/")).toBe("getRoot");
  });

  it("capitalizes path segments", () => {
    expect(toOperationId("GET", "/users")).toBe("getUsers");
    expect(toOperationId("POST", "/users")).toBe("postUsers");
  });

  it("renders parameters as `By${Name}`", () => {
    expect(toOperationId("GET", "/users/:id")).toBe("getUsersById");
    expect(toOperationId("GET", "/users/:userId/posts/:postId")).toBe(
      "getUsersByUserIdPostsByPostId",
    );
  });

  it("treats optional parameters the same as required ones", () => {
    expect(toOperationId("GET", "/files/:name?")).toBe("getFilesByName");
  });
});

describe("generateOpenApiDocument", () => {
  it("produces a well-formed OpenAPI 3.1 document with empty paths", () => {
    const doc = generateOpenApiDocument([], { info: { title: "Test", version: "1.0.0" } });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "Test", version: "1.0.0" });
    expect(doc.paths).toEqual({});
  });

  it("includes servers when supplied", () => {
    const doc = generateOpenApiDocument([], {
      info: { title: "Test", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
    });
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  it("emits one path entry per Nova route, keyed by the OpenAPI path", () => {
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/users", schemas: undefined },
      { method: "POST", path: "/users", schemas: undefined },
      { method: "GET", path: "/users/:id", schemas: undefined },
    ];

    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });

    expect(Object.keys(doc.paths).sort()).toEqual(["/users", "/users/{id}"]);
    expect(doc.paths["/users"]?.get).toBeDefined();
    expect(doc.paths["/users"]?.post).toBeDefined();
    expect(doc.paths["/users/{id}"]?.get).toBeDefined();
  });

  it("adds `in: path` parameters for every placeholder in the path", () => {
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/users/:id/posts/:postId", schemas: undefined },
    ];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    const op = doc.paths["/users/{id}/posts/{postId}"]?.get;
    expect(op?.parameters?.map((p) => p.name)).toEqual(["id", "postId"]);
    for (const p of op?.parameters ?? []) {
      expect(p.in).toBe("path");
      expect(p.required).toBe(true);
    }
  });

  it("uses the params schema's property when available", () => {
    const paramsSchema = makeJsonSchemaCarrier({
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    });
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/users/:id", schemas: { params: paramsSchema } },
    ];
    const doc = generateOpenApiDocument(routes, {
      info: { title: "T", version: "1" },
      schemaConverter: (s) => (s as ReturnType<typeof makeJsonSchemaCarrier>).__json,
    });

    const idParam = doc.paths["/users/{id}"]?.get?.parameters?.[0];
    expect(idParam?.schema).toEqual({ type: "integer" });
  });

  it("emits query parameters from the query schema's properties", () => {
    const querySchema = makeJsonSchemaCarrier({
      type: "object",
      properties: { q: { type: "string" }, page: { type: "integer" } },
      required: ["q"],
    });
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/search", schemas: { query: querySchema } },
    ];
    const doc = generateOpenApiDocument(routes, {
      info: { title: "T", version: "1" },
      schemaConverter: (s) => (s as ReturnType<typeof makeJsonSchemaCarrier>).__json,
    });

    const params = doc.paths["/search"]?.get?.parameters ?? [];
    expect(params).toHaveLength(2);

    const q = params.find((p) => p.name === "q");
    const page = params.find((p) => p.name === "page");
    expect(q?.in).toBe("query");
    expect(q?.required).toBe(true);
    expect(page?.required).toBe(false);
  });

  it("emits a requestBody when a body schema is registered", () => {
    const bodySchema = makeJsonSchemaCarrier({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    const routes: RegisteredRoute[] = [
      { method: "POST", path: "/users", schemas: { body: bodySchema } },
    ];
    const doc = generateOpenApiDocument(routes, {
      info: { title: "T", version: "1" },
      schemaConverter: (s) => (s as ReturnType<typeof makeJsonSchemaCarrier>).__json,
    });

    const body = doc.paths["/users"]?.post?.requestBody;
    expect(body?.required).toBe(true);
    expect(body?.content["application/json"]?.schema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  it("defaults responses to `{ '200': { description: 'OK' } }`", () => {
    const doc = generateOpenApiDocument([{ method: "GET", path: "/", schemas: undefined }], {
      info: { title: "T", version: "1" },
    });
    expect(doc.paths["/"]?.get?.responses).toEqual({ "200": { description: "OK" } });
  });

  it("warns exactly once when no schemaConverter is configured", () => {
    const warnings: string[] = [];
    const routes: RegisteredRoute[] = [
      {
        method: "POST",
        path: "/a",
        schemas: { body: dummySchema() },
      },
      {
        method: "POST",
        path: "/b",
        schemas: { body: dummySchema() },
      },
    ];
    generateOpenApiDocument(routes, { info: { title: "T", version: "1" } }, (msg) => {
      warnings.push(msg);
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/No `schemaConverter`/);
  });
});

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * A Standard Schema that carries its JSON Schema representation in a sidecar
 * property — pretend it is a Zod/Valibot output. Tests provide a converter
 * that reads back from this property to verify the wiring without depending
 * on any real validator library.
 */
function makeJsonSchemaCarrier<J extends object>(json: J): StandardSchemaV1 & { __json: J } {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test",
      validate: (value) => ({ value }),
    },
    __json: json,
  };
}

function dummySchema(): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test",
      validate: (value) => ({ value }),
    },
  };
}

describe("generateOpenApiDocument — responses + metadata", () => {
  it("emits per-status response schemas when declared", () => {
    const okSchema = makeJsonSchemaCarrier({
      type: "object",
      properties: { id: { type: "string" } },
    });
    const notFoundSchema = makeJsonSchemaCarrier({
      type: "object",
      properties: { error: { type: "string" } },
    });

    const routes: RegisteredRoute[] = [
      {
        method: "GET",
        path: "/users/:id",
        schemas: {
          responses: { 200: okSchema, 404: notFoundSchema },
        },
      },
    ];

    const doc = generateOpenApiDocument(routes, {
      info: { title: "T", version: "1" },
      schemaConverter: (s) => (s as ReturnType<typeof makeJsonSchemaCarrier>).__json,
    });

    const responses = doc.paths["/users/{id}"]?.get?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(["200", "404"]);
    expect(responses["200"]?.description).toBe("OK");
    expect(responses["404"]?.description).toBe("Not Found");
    expect(responses["200"]?.content?.["application/json"]?.schema).toMatchObject({
      type: "object",
    });
  });

  it("falls back to `200: { description: 'OK' }` when no responses are declared", () => {
    const doc = generateOpenApiDocument([{ method: "GET", path: "/", schemas: undefined }], {
      info: { title: "T", version: "1" },
    });
    expect(doc.paths["/"]?.get?.responses).toEqual({ "200": { description: "OK" } });
  });

  it("uses a generic description for non-standard status codes", () => {
    const routes: RegisteredRoute[] = [
      {
        method: "GET",
        path: "/x",
        schemas: { responses: { 599: dummySchema() } },
      },
    ];
    const doc = generateOpenApiDocument(routes, {
      info: { title: "T", version: "1" },
      schemaConverter: () => ({}),
    });
    expect(doc.paths["/x"]?.get?.responses["599"]?.description).toBe("Response");
  });

  it("includes summary, description, tags, deprecated when configured", () => {
    const routes: RegisteredRoute[] = [
      {
        method: "GET",
        path: "/legacy",
        schemas: {
          openapi: {
            summary: "Legacy endpoint",
            description: "Will be removed in v2",
            tags: ["legacy", "users"],
            deprecated: true,
          },
        },
      },
    ];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    const op = doc.paths["/legacy"]?.get;
    expect(op?.summary).toBe("Legacy endpoint");
    expect(op?.description).toBe("Will be removed in v2");
    expect(op?.tags).toEqual(["legacy", "users"]);
    expect(op?.deprecated).toBe(true);
  });

  it("respects an operationId override", () => {
    const routes: RegisteredRoute[] = [
      {
        method: "GET",
        path: "/users/:id",
        schemas: { openapi: { operationId: "fetchUser" } },
      },
    ];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    expect(doc.paths["/users/{id}"]?.get?.operationId).toBe("fetchUser");
  });

  it("falls back to auto-generated operationId when no override is supplied", () => {
    const routes: RegisteredRoute[] = [{ method: "GET", path: "/users/:id", schemas: undefined }];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    expect(doc.paths["/users/{id}"]?.get?.operationId).toBe("getUsersById");
  });

  it("omits tags when an empty array is provided", () => {
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/x", schemas: { openapi: { tags: [] } } },
    ];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    expect(doc.paths["/x"]?.get?.tags).toBeUndefined();
  });

  it("does not emit `deprecated: false` for non-deprecated routes", () => {
    const routes: RegisteredRoute[] = [
      { method: "GET", path: "/x", schemas: { openapi: { deprecated: false } } },
    ];
    const doc = generateOpenApiDocument(routes, { info: { title: "T", version: "1" } });
    expect(doc.paths["/x"]?.get?.deprecated).toBeUndefined();
  });
});
