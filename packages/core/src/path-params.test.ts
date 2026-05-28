import { describe, expectTypeOf, it } from "vitest";
import type { ExtractParams } from "./path-params.js";

describe("ExtractParams (type-level)", () => {
  it("returns an empty params object for paths without parameters", () => {
    expectTypeOf<ExtractParams<"/">>().toEqualTypeOf<Readonly<Record<never, never>>>();
    expectTypeOf<ExtractParams<"/health">>().toEqualTypeOf<Readonly<Record<never, never>>>();
    expectTypeOf<ExtractParams<"/api/v1/status">>().toEqualTypeOf<Readonly<Record<never, never>>>();
  });

  it("extracts a single required param", () => {
    expectTypeOf<ExtractParams<"/users/:id">>().toEqualTypeOf<{ readonly id: string }>();
  });

  it("extracts a single optional param when name ends in ?", () => {
    expectTypeOf<ExtractParams<"/users/:id?">>().toEqualTypeOf<{ readonly id?: string }>();
  });

  it("extracts multiple required params in order", () => {
    expectTypeOf<ExtractParams<"/users/:userId/posts/:postId">>().toEqualTypeOf<{
      readonly userId: string;
      readonly postId: string;
    }>();
  });

  it("mixes required and optional", () => {
    expectTypeOf<ExtractParams<"/users/:id/posts/:postId?">>().toEqualTypeOf<{
      readonly id: string;
      readonly postId?: string;
    }>();
  });

  it("disallows access to unknown param keys", () => {
    type P = ExtractParams<"/users/:id">;
    // @ts-expect-error — `foo` is not a declared param.
    type _ShouldFail = P["foo"];
  });

  it("falls back to a permissive shape when the path is not a string literal", () => {
    expectTypeOf<ExtractParams<string>>().toEqualTypeOf<
      Readonly<Record<string, string | undefined>>
    >();
  });

  it("handles param at the very end of the path", () => {
    expectTypeOf<ExtractParams<"/files/:filename">>().toEqualTypeOf<{
      readonly filename: string;
    }>();
  });

  it("handles optional param at the very end of the path", () => {
    expectTypeOf<ExtractParams<"/files/:filename?">>().toEqualTypeOf<{
      readonly filename?: string;
    }>();
  });
});
