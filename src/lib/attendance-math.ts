// Client-side entry point for the shared attendance mathematics.
//
// Same code the Worker runs (see shared/attendance-math.ts), re-exported under
// the app's `@/lib` alias so UI code never re-implements a percentage.
export * from "../../shared/attendance-math";
