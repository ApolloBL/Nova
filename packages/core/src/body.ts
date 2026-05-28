import type { IncomingMessage } from "node:http";
import { badRequest, payloadTooLarge } from "./http-error.js";

/**
 * Drains a request body as a Buffer, enforcing `limit` bytes.
 *
 * Both the Content-Length header and the accumulated stream size are
 * checked, so a stream that lies about its declared length still cannot
 * exhaust memory.
 *
 * @throws `payloadTooLarge` when the body exceeds `limit`.
 */
export async function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw payloadTooLarge(`Body exceeds ${limit} bytes (Content-Length: ${contentLength})`);
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) {
      throw payloadTooLarge(`Body exceeds ${limit} bytes`);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks, size);
}

/**
 * Drains the request body and parses it as JSON. Empty bodies resolve to
 * `undefined`.
 *
 * `JSON.parse` runs with a reviver that drops `__proto__` / `constructor`
 * / `prototype` at every level, so `Object.assign(target, ctx.body)` is
 * safe even with hostile input.
 *
 * @throws `payloadTooLarge` when the body exceeds `limit`.
 * @throws `badRequest("Invalid JSON body")` with the SyntaxError as cause.
 */
export async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const buffer = await readBuffer(req, limit);
  if (buffer.length === 0) return undefined;

  const text = buffer.toString("utf8");
  try {
    return JSON.parse(text, safeJsonReviver) as unknown;
  } catch (err) {
    throw badRequest("Invalid JSON body", { cause: err });
  }
}

/** Drops keys that would mutate `Object.prototype` if the result is merged. */
function safeJsonReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return undefined;
  }
  return value;
}
