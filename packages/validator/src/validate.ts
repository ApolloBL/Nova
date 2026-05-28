import type { StandardSchemaV1 } from "./standard-schema.js";

/**
 * Discriminated outcome of {@link validateStandard}. Narrow on `ok`:
 *
 * ```ts
 * const result = await validateStandard(schema, raw);
 * if (!result.ok) return Response.json({ issues: result.issues }, { status: 422 });
 * use(result.value);
 * ```
 */
export type ValidationOutcome<Output> =
  | { readonly ok: true; readonly value: Output }
  | { readonly ok: false; readonly issues: readonly StandardSchemaV1.Issue[] };

/**
 * Validates `value` against `schema`. Never throws — returns an outcome the
 * caller decides how to surface. Works with sync and async validators alike.
 */
export async function validateStandard<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): Promise<ValidationOutcome<StandardSchemaV1.InferOutput<Schema>>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues === undefined) {
    return {
      ok: true,
      value: result.value as StandardSchemaV1.InferOutput<Schema>,
    };
  }
  return { ok: false, issues: result.issues };
}
