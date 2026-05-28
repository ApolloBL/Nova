import { Nova, type ListenResult } from "@novajs/core";
import { afterEach, describe, expect, it } from "vitest";
import { cors } from "./cors.js";

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

describe("cors()", () => {
  it("passes through requests with no Origin header (same-origin)", async () => {
    const app = new Nova();
    await app.register(cors());
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes `*` for `origin: '*'` (default)", async () => {
    const app = new Nova();
    await app.register(cors());
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://anywhere.example.com" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull();
  });

  it("matches an exact string origin and emits Vary", async () => {
    const app = new Nova();
    await app.register(cors({ origin: "https://app.example.com" }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const allowed = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://app.example.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(allowed.headers.get("vary")).toContain("Origin");

    const denied = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://evil.example.com" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("matches against an array of allowed origins", async () => {
    const app = new Nova();
    await app.register(cors({ origin: ["https://a.com", "https://b.com"] }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    for (const origin of ["https://a.com", "https://b.com"]) {
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }

    const denied = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://c.com" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("matches against a regex origin", async () => {
    const app = new Nova();
    await app.register(cors({ origin: /\.example\.com$/ }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const allowed = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://www.example.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://www.example.com");

    const denied = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://example.org" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("supports a synchronous origin function", async () => {
    const app = new Nova();
    await app.register(cors({ origin: (origin) => origin.startsWith("https://allowed.") }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);

    const allowed = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://allowed.example.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example.com");

    const denied = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://other.example.com" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("supports an async origin function", async () => {
    const app = new Nova();
    await app.register(
      cors({
        origin: async (origin) => {
          await new Promise((r) => setTimeout(r, 5));
          return origin === "https://async.example.com";
        },
      }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://async.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://async.example.com");
  });

  it("handles an OPTIONS preflight without invoking downstream", async () => {
    let handlerRan = false;
    const app = new Nova();
    await app.register(cors({ origin: "https://app.example.com" }));
    app.options("/things", () => {
      handlerRan = true;
      return null;
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/things`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type, x-custom",
      },
    });

    expect(res.status).toBe(204);
    expect(handlerRan).toBe(false);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    // Default mode reflects the requested headers verbatim.
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, x-custom");
    const vary = res.headers.get("vary") ?? "";
    expect(vary).toContain("Origin");
    expect(vary).toContain("Access-Control-Request-Headers");
  });

  it("uses configured allowedHeaders verbatim instead of reflecting", async () => {
    const app = new Nova();
    await app.register(
      cors({ origin: "https://app.example.com", allowedHeaders: ["content-type", "x-api-key"] }),
    );
    app.options("/x", () => null);

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "ignored",
      },
    });

    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, x-api-key");
    // Static config → no need to vary on the request-headers dimension.
    expect(res.headers.get("vary") ?? "").not.toContain("Access-Control-Request-Headers");
  });

  it("emits Access-Control-Max-Age when configured", async () => {
    const app = new Nova();
    await app.register(cors({ origin: "https://app.example.com", maxAge: 600 }));
    app.options("/x", () => null);

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
      },
    });

    expect(res.headers.get("access-control-max-age")).toBe("600");
  });

  it("emits Access-Control-Expose-Headers on regular responses", async () => {
    const app = new Nova();
    await app.register(
      cors({ origin: "https://app.example.com", exposedHeaders: ["x-request-id", "x-elapsed-ms"] }),
    );
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://app.example.com" },
    });

    expect(res.headers.get("access-control-expose-headers")).toBe("x-request-id, x-elapsed-ms");
  });

  it("emits Access-Control-Allow-Credentials when configured", async () => {
    const app = new Nova();
    await app.register(cors({ origin: "https://app.example.com", credentials: true }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://app.example.com" },
    });

    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects `origin: '*' + credentials: true` at config time", () => {
    expect(() => cors({ origin: "*", credentials: true })).toThrowError(
      /incompatible with `credentials: true`/,
    );
  });

  it("appends to an existing Vary header instead of replacing it", async () => {
    const app = new Nova();
    // Upstream middleware sets its own Vary (e.g. content negotiation).
    app.use(async (ctx, next) => {
      ctx.header("vary", "Accept-Encoding");
      await next();
    });
    await app.register(cors({ origin: "https://app.example.com" }));
    app.get("/", () => ({ ok: true }));

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://app.example.com" },
    });

    const vary = res.headers.get("vary") ?? "";
    expect(vary).toContain("Accept-Encoding");
    expect(vary).toContain("Origin");
  });

  it("uses the configured methods list in preflight responses", async () => {
    const app = new Nova();
    await app.register(cors({ origin: "https://app.example.com", methods: ["GET", "POST"] }));
    app.options("/x", () => null);

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
      },
    });

    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST");
  });

  it("non-preflight OPTIONS (no Access-Control-Request-Method) falls through", async () => {
    let handlerRan = false;
    const app = new Nova();
    await app.register(cors());
    app.options("/x", () => {
      handlerRan = true;
      return { method: "OPTIONS" };
    });

    const { port } = await start(app);
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example.com" },
    });

    expect(handlerRan).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
