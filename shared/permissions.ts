// The institution's extra capabilities (plan §9 / P5.2).
//
// One catalogue, imported by the Worker, the admin UI and the tests — so the
// permission a checkbox claims to grant is the permission the API checks, spelled
// the same way in both places. A permission that is not in this list cannot be
// stored: `isPermission()` is the validator, and the grant endpoints refuse
// anything else.
//
// The rule that keeps this honest: every entry here names at least one place in
// `worker/src/index.ts` that calls `hasPermission()` before doing the thing. A
// checkbox that grants nothing is worse than no checkbox.

export const PERMISSIONS = [
  {
    key: "reports.department",
    label: "Department reports",
    description:
      "Read and export attendance reports for every course in their own department, not just the courses they teach.",
  },
  {
    key: "reports.faculty",
    label: "Faculty reports",
    description:
      "Read and export attendance reports for their whole faculty — every department under it.",
  },
  {
    key: "reports.institution",
    label: "Institution-wide reports",
    description:
      "Read and export attendance reports for every course in the institution, and see the institution dashboard figures.",
  },
  {
    key: "results.publish",
    label: "Publish results",
    description:
      "Release marks to students — for the courses they teach only. Without it, a lecturer may record marks but not publish them.",
  },
  {
    key: "imports.people",
    label: "Import people",
    description:
      "Create student, staff and enrolment records from a CSV file. Mark imports are already allowed for the courses they teach.",
  },
  {
    key: "audit.view",
    label: "View the audit trail",
    description:
      "Read the append-only log of corrections, imports, exports and permission changes.",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_KEYS.includes(value);
}

export function permissionLabel(key: string): string {
  return PERMISSIONS.find((p) => p.key === key)?.label ?? key;
}

/** Preserved order for the UI: the report scopes widen, so they read together. */
export function sortPermissions(keys: readonly string[]): Permission[] {
  const order = new Map(PERMISSION_KEYS.map((k, i) => [k, i]));
  return [...keys].filter(isPermission).sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}
