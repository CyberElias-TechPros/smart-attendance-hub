// Root Vitest config.
//
// The suite lives in two places: `worker/tests/**` (the Worker + D1 layer, run
// against an in-memory SQLite shim) and `src/**/*.test.ts` (pure client math).
// Both are listed explicitly so a stray `dist/` or `.wrangler/` artefact can
// never be mistaken for a test file, and so `npx vitest run` in a fresh clone
// behaves exactly like CI does.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "build/**", ".wrangler/**"],
    environment: "node",
    // The D1 shim is a real (in-process) SQLite database per test file; running
    // files in parallel is safe and keeps the suite under ~15 s.
    testTimeout: 20_000,
  },
});
