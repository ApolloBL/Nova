import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@novajs/core": r("./packages/core/src/index.ts"),
      "@novajs/router": r("./packages/router/src/index.ts"),
      "@novajs/validator": r("./packages/validator/src/index.ts"),
      "@novajs/openapi": r("./packages/openapi/src/index.ts"),
      "@novajs/plugins": r("./packages/plugins/src/index.ts"),
    },
  },
});
