// Client-side entry point for the shared grading rules.
//
// Re-exported under the app's `@/lib` alias so UI code never re-implements a
// grade band or a rounding rule.
export * from "../../shared/grades";
