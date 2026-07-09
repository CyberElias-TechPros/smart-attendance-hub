// Client-side PDF & Excel exporters for course reports.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export interface CourseReportData {
  course: { code: string; title: string; level: string; units: number };
  totalSessions: number;
  students: Array<{ id: string; name: string; matricNo: string; attended: number; percentage: number }>;
}

export function exportPDF(report: CourseReportData) {
  const doc = new jsPDF();
  const { course, totalSessions, students } = report;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("SLAMS Attendance Report", 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Course: ${course.code} — ${course.title}`, 14, 28);
  doc.text(`Level: ${course.level}   Units: ${course.units}   Sessions held: ${totalSessions}`, 14, 35);
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

  doc.save(`attendance-${course.code.replace(/\s+/g, "_")}.pdf`);
}

export function exportExcel(report: CourseReportData) {
  const { course, totalSessions, students } = report;
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
  XLSX.writeFile(wb, `attendance-${course.code.replace(/\s+/g, "_")}.xlsx`);
}
