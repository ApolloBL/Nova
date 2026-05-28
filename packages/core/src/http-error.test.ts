import { describe, expect, it } from "vitest";
import {
  badRequest,
  forbidden,
  HttpError,
  httpError,
  internalServerError,
  notFound,
  STATUS_NAMES,
  tooManyRequests,
  unauthorized,
} from "./http-error.js";

describe("HttpError", () => {
  it("is an Error and reports a stable name", () => {
    const err = new HttpError(404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.name).toBe("HttpError");
  });

  it("stores the status code", () => {
    const err = new HttpError(418);
    expect(err.status).toBe(418);
  });

  it("falls back to the canonical reason phrase when no message is given", () => {
    expect(new HttpError(404).message).toBe("Not Found");
    expect(new HttpError(401).message).toBe("Unauthorized");
    expect(new HttpError(500).message).toBe("Internal Server Error");
  });

  it("falls back to a generic message for unknown status codes", () => {
    expect(new HttpError(699).message).toBe("Error");
  });

  it("keeps the user-provided message when one is given", () => {
    expect(new HttpError(404, "User 42 missing").message).toBe("User 42 missing");
  });

  it("exposes 4xx errors by default", () => {
    expect(new HttpError(400).expose).toBe(true);
    expect(new HttpError(404).expose).toBe(true);
    expect(new HttpError(422).expose).toBe(true);
    expect(new HttpError(499).expose).toBe(true);
  });

  it("does not expose 5xx errors by default", () => {
    expect(new HttpError(500).expose).toBe(false);
    expect(new HttpError(503).expose).toBe(false);
  });

  it("respects an explicit expose override in either direction", () => {
    expect(new HttpError(500, "shown", { expose: true }).expose).toBe(true);
    expect(new HttpError(400, "hidden", { expose: false }).expose).toBe(false);
  });

  it("stores an optional custom body", () => {
    const err = new HttpError(400, "bad", { body: { code: "VALIDATION", details: ["x"] } });
    expect(err.body).toEqual({ code: "VALIDATION", details: ["x"] });
  });

  it("defaults `body` to undefined", () => {
    expect(new HttpError(404).body).toBeUndefined();
  });

  it("stores additional headers", () => {
    const err = new HttpError(401, "auth", { headers: { "WWW-Authenticate": "Bearer" } });
    expect(err.headers).toEqual({ "WWW-Authenticate": "Bearer" });
  });

  it("defaults `headers` to a frozen empty object", () => {
    const err = new HttpError(404);
    expect(err.headers).toEqual({});
    expect(Object.isFrozen(err.headers)).toBe(true);
  });

  it("preserves the ES2022 cause chain when provided", () => {
    const inner = new Error("inner");
    const err = new HttpError(503, "wrapper", { cause: inner });
    expect(err.cause).toBe(inner);
  });

  it("omits `cause` from the Error options when none is provided", () => {
    const err = new HttpError(404);
    // `cause` is not set; reading it yields `undefined`.
    expect(err.cause).toBeUndefined();
  });

  it("has a serializable stack trace inherited from Error", () => {
    const err = new HttpError(500);
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("HttpError");
  });
});

describe("STATUS_NAMES", () => {
  it("includes the IETF reason phrases across 2xx, 3xx, 4xx, and 5xx", () => {
    // The map covers success and redirect codes too because `@novajs/openapi`
    // uses it for response descriptions in generated specs.
    expect(STATUS_NAMES[200]).toBe("OK");
    expect(STATUS_NAMES[201]).toBe("Created");
    expect(STATUS_NAMES[204]).toBe("No Content");
    expect(STATUS_NAMES[301]).toBe("Moved Permanently");
    expect(STATUS_NAMES[400]).toBe("Bad Request");
    expect(STATUS_NAMES[404]).toBe("Not Found");
    expect(STATUS_NAMES[500]).toBe("Internal Server Error");
  });

  it("returns undefined for codes outside the curated set", () => {
    expect(STATUS_NAMES[999]).toBeUndefined();
  });

  it("is frozen", () => {
    expect(Object.isFrozen(STATUS_NAMES)).toBe(true);
  });
});

describe("convenience factories", () => {
  it("httpError() is equivalent to new HttpError()", () => {
    const a = httpError(409, "dup");
    const b = new HttpError(409, "dup");
    expect(a.status).toBe(b.status);
    expect(a.message).toBe(b.message);
    expect(a).toBeInstanceOf(HttpError);
  });

  it.each([
    [badRequest, 400],
    [unauthorized, 401],
    [forbidden, 403],
    [notFound, 404],
    [tooManyRequests, 429],
    [internalServerError, 500],
  ])("%o returns an HttpError with the expected status", (factory, status) => {
    const err = factory();
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(status);
  });

  it("forwards message and options through factories", () => {
    const err = notFound("user 42", { headers: { "X-Trace": "abc" } });
    expect(err.message).toBe("user 42");
    expect(err.headers).toEqual({ "X-Trace": "abc" });
  });
});
