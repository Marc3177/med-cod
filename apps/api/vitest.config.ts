import { defineConfig } from "vitest/config";

// These are real-database integration tests (see
// src/test-support/encounter-fixture.ts and
// docs/VALIDATION_METHODOLOGY.md) — each one hits the actual local
// Postgres reference DB (63k+ ICD-10-CM index rows, no in-memory cache
// across calls) and app DB, not a mock, so they run slower than typical
// unit tests. The default 5s vitest timeout is tuned for pure-function
// tests and isn't enough for a test that calls a matching method a few
// times in sequence.
export default defineConfig({
  test: {
    testTimeout: 20000,
    // The P1-E0 evaluation harness (src/evaluation) measures matching
    // QUALITY (recall/precision against a gold-annotated adversarial set),
    // not CORRECTNESS — it's deliberately not part of the `npm test` merge
    // gate. Run it explicitly via `npm run evaluate`, which passes it as an
    // explicit path and so is unaffected by this exclude. See
    // docs/EVALUATION_HARNESS.md.
    exclude: ["**/node_modules/**", "**/dist/**", "src/evaluation/**"],
  },
});
