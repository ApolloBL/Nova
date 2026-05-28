/**
 * Type definitions for the Standard Schema v1 contract.
 *
 * Standard Schema (https://standardschema.dev) is a vendor-neutral shape
 * that validators (Zod, Valibot, ArkType, Effect Schema, …) implement so
 * consumers can accept any of them. Re-declared here rather than depending
 * on `@standard-schema/spec` so this package stays dependency-free.
 */

/**
 * Anything implementing Standard Schema v1. `Input` is the pre-validation
 * type, `Output` the post-validation type — equal for most schemas, but
 * transforming schemas may widen `Input` and narrow `Output`.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

// The spec exposes nested helpers under the `StandardSchemaV1` namespace
// (`StandardSchemaV1.InferOutput`, `StandardSchemaV1.Issue`, …) — refactoring
// to standalone types would break that canonical surface.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1 {
  /** Fields a validator attaches under the `~standard` key. */
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: readonly Issue[];
  }

  /** A single validation problem. */
  export interface Issue {
    readonly message: string;
    readonly path?: readonly (PropertyKey | PathSegment)[] | undefined;
  }

  /**
   * Structured path element. Vendors that need to attach metadata beyond a
   * plain `PropertyKey` emit this shape. Consumers should treat unknown
   * extra keys as opaque.
   */
  export interface PathSegment {
    readonly key: PropertyKey;
  }

  /** Carrier for static `Input`/`Output` inference. */
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}
