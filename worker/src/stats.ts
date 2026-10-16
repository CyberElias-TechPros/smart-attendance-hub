// Server-side entry point for the shared attendance mathematics.
//
// The implementation lives in `shared/attendance-math.ts` so the Cloudflare
// Worker, the React SPA, and the tests all import the *same* code — the plan
// (docs/UPGRADE-PLAN.md §8) requires one formula, not two that drift.
export * from "../../shared/attendance-math";
