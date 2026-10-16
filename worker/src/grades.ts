// Server-side entry point for the shared grading rules.
//
// Same reasoning as `worker/src/stats.ts`: the implementation lives in
// `shared/grades.ts` so the Worker, the SPA and the tests import one module,
// never two that drift.
export * from "../../shared/grades";
