import type { Context } from "./context.js";

/**
 * Sends a handler's return value with content-type inferred from its type:
 * `undefined`/`null` → 204, `string` → text/plain, `Uint8Array` → binary,
 * any other value → JSON. No-op if the handler already declared a body.
 */
export function sendInferred(ctx: Context, value: unknown): void {
  if (ctx.sent) return;

  if (value === undefined || value === null) {
    ctx.noContent();
    return;
  }

  if (typeof value === "string") {
    ctx.text(value);
    return;
  }

  // Buffer extends Uint8Array in Node, so this covers both.
  if (value instanceof Uint8Array) {
    ctx.binary(value);
    return;
  }

  ctx.json(value);
}
