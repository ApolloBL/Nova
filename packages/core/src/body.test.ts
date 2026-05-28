import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readBuffer, readJsonBody } from "./body.js";
import { HttpError } from "./http-error.js";

/**
 * Build a minimal IncomingMessage-like object backed by `node:stream`.
 * Only the surface that `readBuffer` actually touches is implemented.
 */
function mockRequest(
  body: string | Buffer | readonly Buffer[],
  options: { contentLength?: number } = {},
): IncomingMessage {
  const chunks: Buffer[] =
    typeof body === "string"
      ? [Buffer.from(body, "utf8")]
      : Buffer.isBuffer(body)
        ? [body]
        : [...body];

  const stream = Readable.from(chunks);
  const headers: Record<string, string> =
    options.contentLength === undefined ? {} : { "content-length": String(options.contentLength) };

  // We only attach what the readers touch; the cast lets us stay strict
  // without simulating the full IncomingMessage surface.
  return Object.assign(stream, { headers }) as unknown as IncomingMessage;
}

describe("readBuffer", () => {
  it("returns an empty buffer for an empty body", async () => {
    const buf = await readBuffer(mockRequest(""), 1024);
    expect(buf.length).toBe(0);
  });

  it("concatenates multi-chunk streams in order", async () => {
    const req = mockRequest([Buffer.from("hel"), Buffer.from("lo "), Buffer.from("world")]);
    const buf = await readBuffer(req, 1024);
    expect(buf.toString("utf8")).toBe("hello world");
  });

  it("rejects via Content-Length fast-path when over the limit", async () => {
    const req = mockRequest("anything", { contentLength: 2000 });
    await expect(readBuffer(req, 1024)).rejects.toBeInstanceOf(HttpError);
    await expect(readBuffer(req, 1024)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects in-loop when the stream exceeds the limit despite no/lying Content-Length", async () => {
    // 6 chunks of 200 bytes each → 1200 total; limit is 1000. No Content-Length.
    const chunk = Buffer.alloc(200, 0x61); // "aaa..."
    const req = mockRequest([chunk, chunk, chunk, chunk, chunk, chunk]);

    await expect(readBuffer(req, 1000)).rejects.toMatchObject({ status: 413 });
  });

  it("allows bodies at exactly the limit", async () => {
    const chunk = Buffer.alloc(1024, 0x62);
    const req = mockRequest([chunk]);
    const buf = await readBuffer(req, 1024);
    expect(buf.length).toBe(1024);
  });
});

describe("readJsonBody", () => {
  it("returns undefined for an empty body", async () => {
    expect(await readJsonBody(mockRequest(""), 1024)).toBeUndefined();
  });

  it("parses a valid JSON object", async () => {
    const body = JSON.stringify({ name: "Ada", age: 28 });
    expect(await readJsonBody(mockRequest(body), 1024)).toEqual({ name: "Ada", age: 28 });
  });

  it("parses JSON primitives", async () => {
    expect(await readJsonBody(mockRequest("42"), 1024)).toBe(42);
    expect(await readJsonBody(mockRequest('"hi"'), 1024)).toBe("hi");
    expect(await readJsonBody(mockRequest("true"), 1024)).toBe(true);
    expect(await readJsonBody(mockRequest("null"), 1024)).toBeNull();
  });

  it("throws badRequest with a 400 status on invalid JSON", async () => {
    const promise = readJsonBody(mockRequest("{not: json}"), 1024);
    await expect(promise).rejects.toBeInstanceOf(HttpError);
    await expect(promise).rejects.toMatchObject({ status: 400, message: "Invalid JSON body" });
  });

  it("attaches the SyntaxError as `cause` on invalid JSON", async () => {
    try {
      await readJsonBody(mockRequest("not json"), 1024);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).cause).toBeInstanceOf(SyntaxError);
    }
  });

  it("forwards payloadTooLarge from readBuffer", async () => {
    const big = JSON.stringify({ pad: "x".repeat(2000) });
    await expect(readJsonBody(mockRequest(big), 256)).rejects.toMatchObject({ status: 413 });
  });

  it("drops `__proto__` / `constructor` / `prototype` keys at every level", async () => {
    const payload = JSON.stringify({
      legitimate: "value",
      __proto__: { polluted: true },
      nested: {
        ok: 1,
        constructor: { evil: true },
      },
      list: [{ prototype: { x: 1 }, kept: 2 }],
    });

    const parsed = (await readJsonBody(mockRequest(payload), 1024)) as Record<string, unknown>;

    // Forbidden keys are gone — both as own properties and as prototype chain.
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(false);
    expect("polluted" in parsed).toBe(false);
    expect((parsed as Record<string, unknown> & { polluted?: unknown }).polluted).toBeUndefined();

    const nested = parsed["nested"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, "constructor")).toBe(false);
    expect(nested["ok"]).toBe(1);

    const list = parsed["list"] as { prototype?: unknown; kept: number }[];
    expect(Object.prototype.hasOwnProperty.call(list[0], "prototype")).toBe(false);
    expect(list[0]?.kept).toBe(2);

    // The legitimate property survives untouched.
    expect(parsed["legitimate"]).toBe("value");
  });

  it("does not pollute Object.prototype even when downstream code spreads the body", async () => {
    const payload = JSON.stringify({ __proto__: { hijacked: "yes" } });
    const parsed = (await readJsonBody(mockRequest(payload), 1024)) as Record<string, unknown>;

    // The common-but-dangerous pattern: merge body into a target object.
    const target = {} as Record<string, unknown>;
    Object.assign(target, parsed);

    // Without the reviver, this `Object.assign` would set the target's
    // prototype to `{ hijacked: "yes" }`. With the reviver, the key is gone
    // before the merge, so nothing leaks.
    expect((target as Record<string, unknown> & { hijacked?: unknown }).hijacked).toBeUndefined();
    expect(({} as Record<string, unknown> as { hijacked?: unknown }).hijacked).toBeUndefined();
  });
});
