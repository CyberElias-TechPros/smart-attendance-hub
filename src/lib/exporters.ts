// Report exporters. These pull in jsPDF and SheetJS, which together are ~900 kB,
// so every entry point here is imported dynamically at the call site and never
// lands in the initial bundle.

import type { CourseReport, FacultyReport } from "../../shared/schemas";

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeName(value: string): string {
  return value.replace(/[^\w-]+/g, "_");
}

async function loadPdf() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

async function loadXlsx() {
  return import("xlsx");
}

export async function exportCoursePDF(report: CourseReport, threshold: number) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();
  const { course, totalSessions, students } = report;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Attendance Report", 14, 18);

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
    body: students.map((student, index) => [
      String(index + 1),
      student.name,
      student.matricNo,
      String(student.attended),
      String(totalSessions),
      `${student.percentage}%`,
    ]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [15, 92, 75] },
    // Flag students below the institution's threshold so the printed report is
    // actionable rather than just a list of numbers.
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 5) return;
      const student = students[data.row.index];
      if (student && student.percentage < threshold) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save(`attendance-${safeName(course.code)}-${fileStamp()}.pdf`);
}

export async function exportCourseExcel(report: CourseReport) {
  const XLSX = await loadXlsx();
  const { course, totalSessions, students } = report;
  const rows = students.map((student, index) => ({
    "#": index + 1,
    Name: student.name,
    Matric: student.matricNo,
    Attended: student.attended,
    "Sessions held": totalSessions,
    "Attendance %": student.percentage,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Attendance");
  XLSX.writeFile(book, `attendance-${safeName(course.code)}-${fileStamp()}.xlsx`);
}

export async function exportFacultyPDF(report: FacultyReport, threshold: number) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Faculty Attendance Report", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`At-risk threshold: ${threshold}%`, 14, 35);

  autoTable(doc, {
    startY: 43,
    head: [["Course", "Title", "Enrolled", "Sessions", "Average %"]],
    body: report.courses.map((course) => [
      course.code,
      course.title,
      String(course.enrolled),
      String(course.sessions),
      `${course.avg}%`,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 92, 75] },
  });

  const previousTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  autoTable(doc, {
    startY: (previousTable?.finalY ?? 43) + 10,
    head: [["Student", "Matric", "Courses", "Attended", "Total", "%"]],
    body: report.students.map((student) => [
      student.name,
      student.matricNo,
      String(student.courses),
      String(student.attended),
      String(student.total),
      `${student.percentage}%`,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 92, 75] },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 5) return;
      const student = report.students[data.row.index];
      if (student && student.percentage < threshold) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save(`faculty-attendance-${fileStamp()}.pdf`);
}

export async function exportFacultyExcel(report: FacultyReport) {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      report.courses.map((course) => ({
        Course: course.code,
        Title: course.title,
        Enrolled: course.enrolled,
        Sessions: course.sessions,
        "Average %": course.avg,
      })),
    ),
    "Courses",
  );

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      report.students.map((student) => ({
        Student: student.name,
        Matric: student.matricNo,
        Courses: student.courses,
        Attended: student.attended,
        "Sessions held": student.total,
        "Attendance %": student.percentage,
      })),
    ),
    "Students",
  );

  XLSX.writeFile(book, `faculty-attendance-${fileStamp()}.xlsx`);
}
