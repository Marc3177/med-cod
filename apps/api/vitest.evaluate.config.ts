import { defineConfig } from "vitest/config";

// Separate config for `npm run evaluate` — vitest.config.ts EXCLUDES
// src/evaluation/** so a plain `npm test` never runs it (it measures
// matching QUALITY, not correctness); this config's `include` targets
// exactly that directory, with no exclude, so the dedicated `evaluate`
// script can still run it explicitly. See docs/EVALUATION_HARNESS.md.
export default defineConfig({
  test: {
    testTimeout: 300000,
    include: ["src/evaluation/**/*.spec.ts"],
  },
});
