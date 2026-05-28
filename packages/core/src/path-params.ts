type ParamKey<S extends string> = S extends `${infer K}/${string}` ? K : S;
type RemoveFirstSegment<S extends string> = S extends `${string}/${infer Rest}` ? Rest : "";

type ExtractRequiredParams<Path extends string> = Path extends `${string}:${infer Rest}`
  ? ParamKey<Rest> extends `${string}?`
    ? ExtractRequiredParams<RemoveFirstSegment<Rest>>
    : { readonly [K in ParamKey<Rest>]: string } & ExtractRequiredParams<RemoveFirstSegment<Rest>>
  : Record<never, never>;

type ExtractOptionalParams<Path extends string> = Path extends `${string}:${infer Rest}`
  ? ParamKey<Rest> extends `${infer Name}?`
    ? { readonly [K in Name]?: string } & ExtractOptionalParams<RemoveFirstSegment<Rest>>
    : ExtractOptionalParams<RemoveFirstSegment<Rest>>
  : Record<never, never>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Compile-time shape of `ctx.params` derived from a route path pattern.
 *
 * ```ts
 * ExtractParams<"/users/:id">                  // { readonly id: string }
 * ExtractParams<"/files/:name?">               // { readonly name?: string }
 * ExtractParams<"/orgs/:orgId/users/:userId">  // { readonly orgId: string; readonly userId: string }
 * ```
 *
 * Non-literal `string` paths (dynamic registrations) fall back to an open
 * record so callers stay sound.
 */
export type ExtractParams<Path extends string> = string extends Path
  ? Readonly<Record<string, string | undefined>>
  : Simplify<ExtractRequiredParams<Path> & ExtractOptionalParams<Path>>;
