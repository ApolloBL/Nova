import { Nova, type ListenResult } from "@novats/core";
import type { StandardSchemaV1 } from "@novats/validator";
import { afterEach, describe, expect, it } from "vitest";
import { openapi } from "./plugin.js";

let running: ListenResult | undefined;

async function start(app: Nova): Promise<ListenResult> {
  const result = await app.listen(0);
  running = result;
  return result;
}

afterEach(async () => {
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
});

/** A Standard Schema with a sidecar JSON Schema for the test converter. */
function jsonSchema(json: object): StandardSchemaV1 & { __json: object } {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-openapi-test",
      validate: (v) => ({ value: v }),
    },
    __json: json,
  };
}

const passThroughConverter = (s: StandardSchemaV1): unknown =>
  (s as { __json?: unknown }).__json ?? {};

describe("openapi() plugin", () => {
  it("serves an OpenAPI 3.1 document at /openapi.json by default", async () => {
    const app = new Nova();
    app.get("/health", () => ({ ok: true }));

    await app.register(openapi({ info: { title: "T", version: "1" } }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/openapi.json`);

    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("T");
    expect(Object.keys(doc.paths)).toContain("/health");
  });

  it("honors a custom mount path", async () => {
    const app = new Nova();
    app.get("/health", () => ({ ok: true }));

    await app.register(openapi({ info: { title: "T", version: "1" }, path: "/api/_spec" }));

    const { port } = await start(app);
    const found = await fetch(`http://127.0.0.1:${port}/api/_spec`);
    expect(found.status).toBe(200);

    const notFound = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    expect(notFound.status).toBe(404);
  });

  it("includes routes registered both before and after the plugin", async () => {
    const app = new Nova();
    app.get("/before", () => null);

    await app.register(openapi({ info: { title: "T", version: "1" } }));

    app.get("/after", () => null);

    const { port } = await start(app);
    const doc = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
      paths: Record<string, unknown>;
    };

    // Both routes should appear because the plugin generates the document
    // on each request, not at registration time.
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/before", "/after"]));
  });

  it("turns `:id` placeholders into OpenAPI `{id}` placeholders", async () => {
    const app = new Nova();
    app.get("/users/:id", () => null);
    await app.register(openapi({ info: { title: "T", version: "1" } }));

    const { port } = await start(app);
    const doc = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).toContain("/users/{id}");
  });

  it("emits parameters from path placeholders and from the params schema", async () => {
    const paramsSchema = jsonSchema({
      type: "object",
      properties: { id: { type: "integer", minimum: 1 } },
      required: ["id"],
    });

    const app = new Nova();
    app.get("/users/:id", { params: paramsSchema }, () => null);

    await app.register(
      openapi({
        info: { title: "T", version: "1" },
        schemaConverter: passThroughConverter,
      }),
    );

    const { port } = await start(app);
    const doc = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
      paths: Record<
        string,
        { get: { parameters: { name: string; in: string; schema: object }[] } }
      >;
    };

    const params = doc.paths["/users/{id}"]?.get.parameters;
    expect(params).toHaveLength(1);
    expect(params?.[0]?.name).toBe("id");
    expect(params?.[0]?.in).toBe("path");
    expect(params?.[0]?.schema).toEqual({ type: "integer", minimum: 1 });
  });

  it("emits a requestBody for body-validated routes", async () => {
    const bodySchema = jsonSchema({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });

    const app = new Nova();
    app.post("/users", { body: bodySchema }, () => null);

    await app.register(
      openapi({
        info: { title: "T", version: "1" },
        schemaConverter: passThroughConverter,
      }),
    );

    const { port } = await start(app);
    const doc = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
      paths: Record<
        string,
        { post: { requestBody: { content: Record<string, { schema: object }> } } }
      >;
    };

    const body = doc.paths["/users"]?.post.requestBody;
    expect(body?.content["application/json"]?.schema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  });

  it("does not include itself (`/openapi.json`) in the generated paths", async () => {
    // The openapi route is a normal Nova GET registration, so it WILL appear
    // in `app.routes()`. This test pins that behavior: callers who want to
    // hide the spec endpoint can filter at the converter / post-processor.
    const app = new Nova();
    await app.register(openapi({ info: { title: "T", version: "1" } }));
    const { port } = await start(app);
    const doc = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
      paths: Record<string, unknown>;
    };

    expect(Object.keys(doc.paths)).toContain("/openapi.json");
  });

  it("does not mount Swagger UI when `ui` is not configured", async () => {
    const app = new Nova();
    await app.register(openapi({ info: { title: "T", version: "1" } }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/docs`);

    expect(res.status).toBe(404);
  });

  it("mounts Swagger UI at /docs when `ui: {}` is supplied", async () => {
    const app = new Nova();
    await app.register(openapi({ info: { title: "Demo", version: "1" }, ui: {} }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/docs`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);

    const html = await res.text();
    expect(html).toContain("<title>Demo</title>");
    expect(html).toContain("swagger-ui-dist");
    expect(html).toContain('"/openapi.json"');
  });

  it("honors a custom UI path", async () => {
    const app = new Nova();
    await app.register(
      openapi({ info: { title: "T", version: "1" }, ui: { path: "/admin/docs" } }),
    );

    const { port } = await start(app);

    const custom = await fetch(`http://127.0.0.1:${port}/admin/docs`);
    expect(custom.status).toBe(200);

    const defaultPath = await fetch(`http://127.0.0.1:${port}/docs`);
    expect(defaultPath.status).toBe(404);
  });

  it("uses a custom UI title when supplied", async () => {
    const app = new Nova();
    await app.register(
      openapi({ info: { title: "T", version: "1" }, ui: { title: "API Console" } }),
    );

    const { port } = await start(app);
    const html = await (await fetch(`http://127.0.0.1:${port}/docs`)).text();

    expect(html).toContain("<title>API Console</title>");
  });

  it("escapes HTML in the UI title to prevent injection", async () => {
    const app = new Nova();
    await app.register(
      openapi({
        info: { title: "T", version: "1" },
        ui: { title: '<script>alert("xss")</script>' },
      }),
    );

    const { port } = await start(app);
    const html = await (await fetch(`http://127.0.0.1:${port}/docs`)).text();

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});
