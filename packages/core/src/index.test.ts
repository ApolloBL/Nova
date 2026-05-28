import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";

describe("@novats/core public surface", () => {
  it("exposes Nova and Context", () => {
    expect(publicApi.Nova).toBeTypeOf("function");
    expect(publicApi.Context).toBeTypeOf("function");
  });
});
