import type { Context } from "./context.js";

/**
 * Continuation passed to a middleware. Resolves once the rest of the chain
 * (downstream middleware + terminal) has finished.
 */
export type Next = () => Promise<void>;

/**
 * Onion-style middleware. Awaiting `next()` yields back after the
 * downstream chain completes, enabling natural after-phase work.
 *
 * Omitting the `next()` call short-circuits the chain. Calling it more than
 * once throws.
 */
export type Middleware = (ctx: Context, next: Next) => void | Promise<void>;

const NOOP_TERMINAL: Next = () => Promise.resolve();

/**
 * Runs a middleware chain to completion, then invokes the terminal.
 *
 * The terminal — typically the matched route handler — is passed separately
 * to avoid allocating `[...middleware, terminal]` on every request.
 */
export async function runChain(
  middleware: readonly Middleware[],
  ctx: Context,
  terminal: Next = NOOP_TERMINAL,
): Promise<void> {
  let index = -1;

  async function dispatch(i: number): Promise<void> {
    if (i <= index) {
      throw new Error("Middleware chain: next() called multiple times");
    }
    index = i;

    if (i >= middleware.length) {
      return terminal();
    }

    const fn = middleware[i];
    if (fn === undefined) {
      // noUncheckedIndexedAccess widens the lookup; skip and continue.
      return dispatch(i + 1);
    }

    await fn(ctx, () => dispatch(i + 1));
  }

  return dispatch(0);
}
