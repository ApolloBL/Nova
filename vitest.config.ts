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
      "@novats/core": r("./packages/core/src/index.ts"),
      "@novats/router": r("./packages/router/src/index.ts"),
      "@novats/validator": r("./packages/validator/src/index.ts"),
      "@novats/openapi": r("./packages/openapi/src/index.ts"),
      "@novats/plugins": r("./packages/plugins/src/index.ts"),
    },
  },
});
