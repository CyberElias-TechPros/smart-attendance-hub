// Shared shapes for the client-side report exporters (src/lib/exporters.ts).

export interface CourseReportData {
  course: { code: string; title: string; level: string; units: number };
  totalSessions: number;
  students: Array<{
    id: string;
    name: string;
    matricNo: string;
    attended: number;
    percentage: number;
  }>;
}

export interface ExportOptions {
  institutionName?: string;
}
