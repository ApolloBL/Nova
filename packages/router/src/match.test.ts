import { describe, expect, it } from "vitest";
import {
  createTrieNode,
  insertIntoTrie,
  isStaticPattern,
  matchTrie,
  parsePattern,
  splitPath,
} from "./match.js";

describe("parsePattern", () => {
  it("returns no segments for root patterns", () => {
    expect(parsePattern("")).toEqual([]);
    expect(parsePattern("/")).toEqual([]);
  });

  it("parses literal segments", () => {
    expect(parsePattern("/users/list")).toEqual([
      { kind: "static", value: "users" },
      { kind: "static", value: "list" },
    ]);
  });

  it("parses required parameters", () => {
    expect(parsePattern("/users/:id")).toEqual([
      { kind: "static", value: "users" },
      { kind: "param", name: "id", optional: false },
    ]);
  });

  it("parses optional parameters at the end", () => {
    expect(parsePattern("/users/:id?")).toEqual([
      { kind: "static", value: "users" },
      { kind: "param", name: "id", optional: true },
    ]);
  });

  it("rejects optional parameters in the middle", () => {
    expect(() => parsePattern("/users/:id?/posts")).toThrow(
      /Optional parameter must appear as the last segment/,
    );
  });

  it("rejects empty parameter names", () => {
    expect(() => parsePattern("/users/:")).toThrow(/Invalid parameter name/);
  });

  it("rejects parameter names with invalid characters", () => {
    expect(() => parsePattern("/users/:1id")).toThrow(/Invalid parameter name/);
    expect(() => parsePattern("/users/:id-name")).toThrow(/Invalid parameter name/);
  });
});

describe("splitPath", () => {
  it("returns no segments for root", () => {
    expect(splitPath("")).toEqual([]);
    expect(splitPath("/")).toEqual([]);
  });

  it("returns one segment for shallow paths", () => {
    expect(splitPath("/users")).toEqual(["users"]);
  });

  it("preserves trailing slash as an empty segment", () => {
    expect(splitPath("/users/")).toEqual(["users", ""]);
  });

  it("splits multi-segment paths", () => {
    expect(splitPath("/users/123/posts")).toEqual(["users", "123", "posts"]);
  });
});

describe("isStaticPattern", () => {
  it("returns true when no segment is parametric", () => {
    expect(isStaticPattern(parsePattern("/users/list"))).toBe(true);
    expect(isStaticPattern(parsePattern("/"))).toBe(true);
  });

  it("returns false as soon as one segment is parametric", () => {
    expect(isStaticPattern(parsePattern("/users/:id"))).toBe(false);
    expect(isStaticPattern(parsePattern("/users/:id?"))).toBe(false);
  });
});

describe("insertIntoTrie + matchTrie", () => {
  it("matches a simple parametric route", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "show", "/users/:id");

    const result = matchTrie(root, splitPath("/users/42"));
    expect(result).toEqual({ handler: "show", params: { id: "42" } });
  });

  it("returns undefined when no route matches", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "show", "/users/:id");

    expect(matchTrie(root, splitPath("/posts/1"))).toBeUndefined();
  });

  it("matches multiple parametric segments", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(
      root,
      parsePattern("/users/:userId/posts/:postId"),
      "nested",
      "/users/:userId/posts/:postId",
    );

    const result = matchTrie(root, splitPath("/users/7/posts/13"));
    expect(result).toEqual({
      handler: "nested",
      params: { userId: "7", postId: "13" },
    });
  });

  it("prefers a static branch over a parametric one (static wins)", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "param", "/users/:id");
    insertIntoTrie(root, parsePattern("/users/me"), "static", "/users/me");

    expect(matchTrie(root, splitPath("/users/me"))).toEqual({
      handler: "static",
      params: {},
    });
    expect(matchTrie(root, splitPath("/users/123"))).toEqual({
      handler: "param",
      params: { id: "123" },
    });
  });

  it("backtracks from a partial static match into the parametric branch", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id/profile"), "param", "/users/:id/profile");
    insertIntoTrie(root, parsePattern("/users/me/account"), "static", "/users/me/account");

    // `/users/me/profile` partially matches the static `/users/me/...` branch,
    // but that branch has no `/profile` child. The matcher must back-track and
    // try the parametric branch, where `:id = "me"`.
    expect(matchTrie(root, splitPath("/users/me/profile"))).toEqual({
      handler: "param",
      params: { id: "me" },
    });
  });

  it("supports an optional trailing parameter", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id?"), "maybe", "/users/:id?");

    expect(matchTrie(root, splitPath("/users"))).toEqual({
      handler: "maybe",
      params: {},
    });
    expect(matchTrie(root, splitPath("/users/123"))).toEqual({
      handler: "maybe",
      params: { id: "123" },
    });
  });

  it("throws when the same pattern is registered twice", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "first", "/users/:id");

    expect(() =>
      insertIntoTrie(root, parsePattern("/users/:id"), "second", "/users/:id"),
    ).toThrowError("Route already registered: /users/:id");
  });

  it("throws on structurally-equivalent patterns with different parameter names", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "a", "/users/:id");

    // `/users/:userId` has the same matching shape as `/users/:id`; only the
    // local label differs. The matcher treats them as the same route.
    expect(() =>
      insertIntoTrie(root, parsePattern("/users/:userId"), "b", "/users/:userId"),
    ).toThrowError(/Route conflict: "\/users\/:userId" has the same matching shape/);
  });

  it("throws on structurally-equivalent patterns with different optionality", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "a", "/users/:id");

    expect(() =>
      insertIntoTrie(root, parsePattern("/users/:id?"), "b", "/users/:id?"),
    ).toThrowError(/Route conflict: "\/users\/:id\?" has the same matching shape/);
  });

  it("allows different routes that share a parametric prefix with different names", () => {
    // Regression: previously the matcher rejected this combo because it
    // stored the parameter NAME on the trie node. Names are now local to each
    // route, so `:id` and `:userId` at the same depth coexist when their
    // patterns ultimately terminate at different nodes.
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "show", "/users/:id");
    insertIntoTrie(
      root,
      parsePattern("/users/:userId/posts/:postId"),
      "nested",
      "/users/:userId/posts/:postId",
    );

    expect(matchTrie(root, splitPath("/users/42"))).toEqual({
      handler: "show",
      params: { id: "42" },
    });
    expect(matchTrie(root, splitPath("/users/7/posts/13"))).toEqual({
      handler: "nested",
      params: { userId: "7", postId: "13" },
    });
  });

  it("allows the same parametric prefix to branch into different terminals", () => {
    const root = createTrieNode<string>();
    insertIntoTrie(root, parsePattern("/users/:id"), "show", "/users/:id");
    insertIntoTrie(root, parsePattern("/users/:id/posts"), "list-posts", "/users/:id/posts");

    expect(matchTrie(root, splitPath("/users/1"))).toEqual({
      handler: "show",
      params: { id: "1" },
    });
    expect(matchTrie(root, splitPath("/users/1/posts"))).toEqual({
      handler: "list-posts",
      params: { id: "1" },
    });
  });
});
