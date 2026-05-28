import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "./standard-schema.js";
import { validateStandard } from "./validate.js";

/**
 * Tiny hand-rolled Standard Schema implementation used to test the validator
 * without dragging in a real schema library. The runtime contract is exactly
 * what `validateStandard` consumes.
 */
function stringSchema(): StandardSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test",
      validate: (value) =>
        typeof value === "string" ? { value } : { issues: [{ message: "Expected string" }] },
    },
  };
}

function asyncNonEmpty(): StandardSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test-async",
      validate: async (value) => {
        await Promise.resolve();
        if (typeof value !== "string") return { issues: [{ message: "Expected string" }] };
        if (value.length === 0) return { issues: [{ message: "Empty", path: ["length"] }] };
        return { value };
      },
    },
  };
}

function transformingNumber(): StandardSchemaV1<string, number> {
  return {
    "~standard": {
      version: 1,
      vendor: "nova-test-transform",
      validate: (value) => {
        if (typeof value !== "string") return { issues: [{ message: "Expected string" }] };
        const n = Number(value);
        return Number.isFinite(n) ? { value: n } : { issues: [{ message: "Not a number" }] };
      },
    },
  };
}

describe("validateStandard", () => {
  it("returns ok:true with the validated value on success", async () => {
    const result = await validateStandard(stringSchema(), "hello");
    expect(result).toEqual({ ok: true, value: "hello" });
  });

  it("returns ok:false with the issues on failure", async () => {
    const result = await validateStandard(stringSchema(), 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([{ message: "Expected string" }]);
    }
  });

  it("awaits async validators uniformly", async () => {
    const ok = await validateStandard(asyncNonEmpty(), "value");
    expect(ok).toEqual({ ok: true, value: "value" });

    const fail = await validateStandard(asyncNonEmpty(), "");
    expect(fail.ok).toBe(false);
  });

  it("propagates issue paths verbatim", async () => {
    const fail = await validateStandard(asyncNonEmpty(), "");
    if (!fail.ok) {
      expect(fail.issues[0]?.path).toEqual(["length"]);
    }
  });

  it("returns the transformed output for transforming schemas", async () => {
    const result = await validateStandard(transformingNumber(), "42");
    expect(result).toEqual({ ok: true, value: 42 });
    if (result.ok) {
      // Static type assertion: TS infers `number` because the schema's Output is `number`.
      const n: number = result.value;
      expect(n).toBe(42);
    }
  });

  it("rejects a transforming schema's non-string input cleanly", async () => {
    const result = await validateStandard(transformingNumber(), 42);
    expect(result.ok).toBe(false);
  });

  it("does not throw when the validator throws", async () => {
    // A non-spec-compliant validator that throws should at least not destroy
    // the application — `validateStandard` lets the rejection bubble so the
    // caller's existing error pipeline (e.g. Nova's onError) handles it.
    const buggy: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "buggy",
        validate: () => {
          throw new Error("validator exploded");
        },
      },
    };

    await expect(validateStandard(buggy, "x")).rejects.toThrow("validator exploded");
  });
});
