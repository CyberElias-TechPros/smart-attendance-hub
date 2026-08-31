// Client-side PDF & Excel exporters for course reports.
// Heavy dependencies (jspdf, xlsx) are lazy-loaded so the app shell stays
// fast; they only download when a user actually exports a report.
import type { CourseReportData, ExportOptions } from "./export-types";

function safeFileName(code: string): string {
  return code.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "course";
}

export async function exportPDF(report: CourseReportData, options: ExportOptions = {}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { course, totalSessions, students } = report;
  const institution = options.institutionName ?? "SLAMS";

  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${institution} — Attendance Report`, 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Course: ${course.code} — ${course.title}`, 14, 28);
  doc.text(
    `Level: ${course.level}   Units: ${course.units}   Sessions held: ${totalSessions}`,
    14,
    35,
  );
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 42);

  autoTable(doc, {
    startY: 50,
    head: [["#", "Name", "Matric", "Attended", "Total", "%"]],
    body: students.map((s, i) => [
      String(i + 1),
      s.name,
      s.matricNo,
      String(s.attended),
      String(totalSessions),
      `${s.percentage}%`,
    ]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [15, 92, 75] },
  });

  doc.save(`attendance-${safeFileName(course.code)}.pdf`);
}

export async function exportExcel(report: CourseReportData, _options: ExportOptions = {}) {
  const XLSX = await import("xlsx");
  const { course, totalSessions, students } = report;
  void course;
  const rows = students.map((s, i) => ({
    "#": i + 1,
    Name: s.name,
    Matric: s.matricNo,
    Attended: s.attended,
    Total: totalSessions,
    "Attendance %": s.percentage,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");
  XLSX.writeFile(wb, `attendance-${safeFileName(course.code)}.xlsx`);
}
