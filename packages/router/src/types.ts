/** HTTP methods recognized by the router. */
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/**
 * Successful match returned by {@link Router.find}. `params` is always
 * present — routes with no parameters get a frozen empty object so callers
 * can read it without a null check.
 */
export interface RouteMatch<H> {
  readonly handler: H;
  readonly params: Readonly<Record<string, string>>;
}

/** One row yielded by {@link Router.entries}, for introspection tooling. */
export interface RouteEntry<H> {
  readonly method: Method;
  readonly path: string;
  readonly value: H;
}
