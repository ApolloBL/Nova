import { describe, expect, it } from "vitest";
import { parseQueryString } from "./query.js";

describe("parseQueryString", () => {
  it("returns an empty record for an empty input", () => {
    expect(parseQueryString("")).toEqual({});
    expect(parseQueryString("?")).toEqual({});
  });

  it("parses a single key=value pair", () => {
    expect(parseQueryString("?foo=bar")).toEqual({ foo: "bar" });
  });

  it("accepts input with or without the leading `?`", () => {
    expect(parseQueryString("foo=bar")).toEqual({ foo: "bar" });
    expect(parseQueryString("?foo=bar")).toEqual({ foo: "bar" });
  });

  it("parses multiple pairs", () => {
    expect(parseQueryString("?a=1&b=2&c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("collects repeated keys into an ordered array", () => {
    expect(parseQueryString("?id=1&id=2")).toEqual({ id: ["1", "2"] });
    expect(parseQueryString("?id=1&id=2&id=3")).toEqual({ id: ["1", "2", "3"] });
  });

  it("treats a bare key as an empty string", () => {
    expect(parseQueryString("?foo")).toEqual({ foo: "" });
    expect(parseQueryString("?foo&bar=ok")).toEqual({ foo: "", bar: "ok" });
  });

  it("URL-decodes both keys and values", () => {
    expect(parseQueryString("?msg=hello%20world")).toEqual({ msg: "hello world" });
    expect(parseQueryString("?my%20key=value")).toEqual({ "my key": "value" });
  });

  it("decodes `+` as a space (form-urlencoded)", () => {
    expect(parseQueryString("?msg=hello+world")).toEqual({ msg: "hello world" });
  });

  it("preserves order across mixed keys", () => {
    const r = parseQueryString("?a=1&b=2&a=3");
    expect(r).toEqual({ a: ["1", "3"], b: "2" });
  });

  it("drops the forbidden keys `__proto__`, `constructor`, `prototype`", () => {
    const r = parseQueryString("?__proto__=a&constructor=b&prototype=c&safe=ok");
    expect(r).toEqual({ safe: "ok" });
  });

  it("does not contaminate Object.prototype even with crafted keys", () => {
    const proto = Object.prototype as Record<string, unknown>;
    const before = Object.keys(proto);
    parseQueryString("?__proto__[polluted]=yes&__proto__=raw");
    expect(Object.keys(proto)).toEqual(before);
    expect(proto["polluted"]).toBeUndefined();
  });

  it("returns a frozen object", () => {
    const r = parseQueryString("?a=1");
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r as Record<string, unknown>)["b"] = "boom";
    }).toThrow(TypeError);
  });

  it("returns an object with no prototype (immune to prototype-chain lookups)", () => {
    const r = parseQueryString("?a=1");
    expect(Object.getPrototypeOf(r)).toBeNull();
    expect((r as Record<string, unknown>)["toString"]).toBeUndefined();
  });

  it("shares the empty result across calls (referential equality)", () => {
    expect(parseQueryString("")).toBe(parseQueryString(""));
    expect(parseQueryString("?")).toBe(parseQueryString(""));
  });

  it("caps the number of distinct keys at MAX_QUERY_KEYS (DoS guard)", async () => {
    const { MAX_QUERY_KEYS } = await import("./query.js");
    // Build a query string with MAX + 50 distinct keys.
    const parts: string[] = [];
    for (let i = 0; i < MAX_QUERY_KEYS + 50; i++) parts.push(`k${i}=v`);
    const search = `?${parts.join("&")}`;

    const result = parseQueryString(search) as Record<string, string>;
    const keys = Object.keys(result);

    expect(keys).toHaveLength(MAX_QUERY_KEYS);
    // First MAX_QUERY_KEYS distinct keys are preserved; the tail is dropped.
    expect(keys[0]).toBe("k0");
    expect(keys[MAX_QUERY_KEYS - 1]).toBe(`k${MAX_QUERY_KEYS - 1}`);
    expect(result[`k${MAX_QUERY_KEYS}`]).toBeUndefined();
  });

  it("does not count repeated keys against the cap", async () => {
    const { MAX_QUERY_KEYS } = await import("./query.js");
    // One distinct key repeated many times. Should fit in one slot.
    const parts: string[] = [];
    for (let i = 0; i < MAX_QUERY_KEYS + 100; i++) parts.push(`same=${i}`);
    const search = `?${parts.join("&")}`;

    const result = parseQueryString(search) as Record<string, string | string[]>;
    expect(Object.keys(result)).toEqual(["same"]);
    const values = result["same"];
    expect(Array.isArray(values)).toBe(true);
    expect((values as string[]).length).toBe(MAX_QUERY_KEYS + 100);
  });
});
