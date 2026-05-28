import { describe, expect, it } from "vitest";
import { Router } from "./router.js";

describe("Router", () => {
  it("finds a registered route", () => {
    const router = new Router<() => string>();
    const handler = (): string => "ok";
    router.add("GET", "/", handler);

    const match = router.find("GET", "/");
    expect(match?.handler).toBe(handler);
  });

  it("returns undefined for unknown path", () => {
    const router = new Router<() => string>();
    router.add("GET", "/", () => "ok");

    expect(router.find("GET", "/unknown")).toBeUndefined();
  });

  it("returns undefined for unknown method on a known path", () => {
    const router = new Router<() => string>();
    router.add("GET", "/", () => "ok");

    expect(router.find("POST", "/")).toBeUndefined();
  });

  it("treats `/foo` and `/foo/` as distinct paths", () => {
    const router = new Router<string>();
    router.add("GET", "/foo", "a");
    router.add("GET", "/foo/", "b");

    expect(router.find("GET", "/foo")?.handler).toBe("a");
    expect(router.find("GET", "/foo/")?.handler).toBe("b");
  });

  it("allows the same path under different methods", () => {
    const router = new Router<string>();
    router.add("GET", "/users", "list");
    router.add("POST", "/users", "create");

    expect(router.find("GET", "/users")?.handler).toBe("list");
    expect(router.find("POST", "/users")?.handler).toBe("create");
  });

  it("throws when registering the same method + path twice", () => {
    const router = new Router<string>();
    router.add("GET", "/", "first");

    expect(() => router.add("GET", "/", "second")).toThrowError("Route already registered: GET /");
  });

  it("does not leak entries across instances", () => {
    const a = new Router<string>();
    const b = new Router<string>();
    a.add("GET", "/", "from-a");

    expect(b.find("GET", "/")).toBeUndefined();
  });

  it("returns a frozen empty params object for static routes", () => {
    const router = new Router<string>();
    router.add("GET", "/users", "list");

    const match = router.find("GET", "/users");
    expect(match?.params).toEqual({});
    expect(Object.isFrozen(match?.params)).toBe(true);
  });

  it("matches parametric routes and extracts params", () => {
    const router = new Router<string>();
    router.add("GET", "/users/:id", "show");

    const match = router.find("GET", "/users/42");
    expect(match?.handler).toBe("show");
    expect(match?.params).toEqual({ id: "42" });
  });

  it("lets static routes coexist with parametric routes (static wins)", () => {
    const router = new Router<string>();
    router.add("GET", "/users/:id", "param");
    router.add("GET", "/users/me", "static");

    expect(router.find("GET", "/users/me")?.handler).toBe("static");
    expect(router.find("GET", "/users/me")?.params).toEqual({});
    expect(router.find("GET", "/users/123")?.handler).toBe("param");
    expect(router.find("GET", "/users/123")?.params).toEqual({ id: "123" });
  });

  it("matches an optional trailing parameter both with and without value", () => {
    const router = new Router<string>();
    router.add("GET", "/users/:id?", "maybe");

    expect(router.find("GET", "/users")?.params).toEqual({});
    expect(router.find("GET", "/users/7")?.params).toEqual({ id: "7" });
  });

  it("throws on duplicate parametric route", () => {
    const router = new Router<string>();
    router.add("GET", "/users/:id", "first");

    expect(() => router.add("GET", "/users/:id", "second")).toThrowError(
      "Route already registered: GET /users/:id",
    );
  });

  it("throws on invalid pattern at registration time", () => {
    const router = new Router<string>();

    expect(() => router.add("GET", "/users/:id?/posts", "x")).toThrowError(
      /Optional parameter must appear as the last segment/,
    );
    expect(() => router.add("GET", "/users/:1id", "x")).toThrowError(/Invalid parameter name/);
  });

  describe("entries()", () => {
    it("yields nothing for an empty router", () => {
      const router = new Router<string>();
      expect([...router.entries()]).toEqual([]);
    });

    it("yields every static route with its method and path", () => {
      const router = new Router<string>();
      router.add("GET", "/users", "list");
      router.add("POST", "/users", "create");
      router.add("GET", "/health", "health");

      const entries = [...router.entries()];
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual({ method: "GET", path: "/users", value: "list" });
      expect(entries).toContainEqual({ method: "POST", path: "/users", value: "create" });
      expect(entries).toContainEqual({ method: "GET", path: "/health", value: "health" });
    });

    it("yields parametric routes with the original path pattern", () => {
      const router = new Router<string>();
      router.add("GET", "/users/:id", "show");
      router.add("GET", "/users/:userId/posts/:postId", "nested");
      router.add("GET", "/files/:name?", "maybe");

      const paths = [...router.entries()].map((e) => e.path).sort();
      expect(paths).toEqual(["/files/:name?", "/users/:id", "/users/:userId/posts/:postId"]);
    });

    it("yields both static and parametric routes for the same prefix", () => {
      const router = new Router<string>();
      router.add("GET", "/users/me", "static");
      router.add("GET", "/users/:id", "param");

      const entries = [...router.entries()];
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.path).sort()).toEqual(["/users/:id", "/users/me"]);
    });

    it("does not include matcher internals in the yielded value", () => {
      const router = new Router<{ tag: string }>();
      const handler = { tag: "users" };
      router.add("GET", "/users/:id", handler);

      const entries = [...router.entries()];
      expect(entries[0]?.value).toBe(handler);
    });
  });
});
