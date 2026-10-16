// The downloadable PDF report.
//
// jsPDF + autoTable draw the document programmatically, which is what makes the
// brief's print requirements real rather than cosmetic:
//   * the institution header and the reporting period are repeated on EVERY page
//     (drawHeader) and the footer carries "Page x of y" (drawFooter);
//   * `showHead: "everyPage"` repeats the table's column headings;
//   * totals, present/absent/late and percentages all come from the same
//     ReportDataset the screen rendered.

import { averageLecturesPerStudent, type ReportDataset } from "../report-dataset";

const MARGIN = 14;
const HEADER_HEIGHT = 34;

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Best-effort logo embedding: a failed fetch must never block an export. */
async function loadLogo(
  doc: unknown,
  url?: string,
): Promise<{ dataUrl: string; format: string } | null> {
  void doc;
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo read failed"));
      reader.readAsDataURL(blob);
    });
    const format = blob.type.includes("png") ? "PNG" : "JPEG";
    return { dataUrl, format };
  } catch {
    return null;
  }
}

export async function exportReportPdf(dataset: ReportDataset): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const logo = await loadLogo(doc, dataset.logoUrl);

  const drawHeader = () => {
    doc.setFillColor(15, 92, 75);
    doc.rect(0, 0, pageWidth, 3, "F");
    let textX = MARGIN;
    if (logo) {
      try {
        doc.addImage(logo.dataUrl, logo.format, MARGIN, 8, 14, 14);
        textX = MARGIN + 18;
      } catch {
        /* unsupported image: fall through to the text-only header */
      }
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(dataset.institution, textX, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(dataset.title, textX, 21);
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    doc.text(dataset.periodLabel, textX, 26);
    doc.setTextColor(0);
    doc.setDrawColor(220);
    doc.line(MARGIN, HEADER_HEIGHT - 3, pageWidth - MARGIN, HEADER_HEIGHT - 3);
  };

  const drawFooter = (data: { pageNumber: number; pageCount?: number }) => {
    const total = data.pageCount ? ` of ${data.pageCount}` : "";
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Generated ${formatDateTime(dataset.generatedAt)}${dataset.generatedBy ? ` by ${dataset.generatedBy}` : ""}`,
      MARGIN,
      pageHeight - 8,
    );
    doc.text(`Page ${data.pageNumber}${total}`, pageWidth - MARGIN, pageHeight - 8, {
      align: "right",
    });
    if (dataset.footerNote) {
      doc.text(dataset.footerNote, pageWidth / 2, pageHeight - 8, { align: "center" });
    }
  };

  drawHeader();

  // ── Cover block: what this report is, and over which slice of data ──
  let cursor = HEADER_HEIGHT + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Report summary", MARGIN, cursor);
  cursor += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const meta: string[] = [
    `Reporting period: ${dataset.periodLabel}`,
    `Courses included: ${dataset.totals.courses}`,
    `Students on rosters: ${dataset.totals.enrolled}`,
    `Lectures held: ${dataset.totals.classesHeld}`,
    `Overall attendance: ${dataset.totals.rate === null ? "n/a" : `${dataset.totals.rate}%`} (target ${dataset.threshold}%)`,
    `Present / late / excused / absent: ${dataset.totals.present} / ${dataset.totals.late} / ${dataset.totals.excused} / ${dataset.totals.absent}`,
  ];
  const average = averageLecturesPerStudent(dataset);
  if (average !== null) meta.push(`Average lectures per course: ${average}`);
  if (dataset.filterLabels.length) meta.push(`Filters: ${dataset.filterLabels.join(" · ")}`);
  for (const line of meta) {
    doc.text(line, MARGIN, cursor);
    cursor += 4.6;
  }

  const studentRows = dataset.course?.report.students ?? [];
  const lectureRows = dataset.course?.lectures ?? [];

  // ── Per-course summary table (the brief's §4 columns) ──
  autoTable(doc, {
    startY: cursor + 3,
    margin: { top: HEADER_HEIGHT, left: MARGIN, right: MARGIN, bottom: 14 },
    head: [
      [
        "#",
        "Code",
        "Course title",
        "Dept",
        "Students",
        "Classes held",
        "Attended",
        "Present",
        "Absent",
        "Late",
        "%",
      ],
    ],
    body: dataset.rows.map((row, index) => [
      String(index + 1),
      row.code,
      row.title,
      row.departmentCode ?? "—",
      String(row.enrolled),
      String(row.classesHeld),
      String(row.classesAttended),
      String(row.present),
      String(row.absent),
      String(row.late),
      row.rate === null ? "—" : `${row.rate}%`,
    ]),
    foot: [
      [
        "",
        "TOTAL",
        `${dataset.totals.courses} courses`,
        "",
        String(dataset.totals.enrolled),
        String(dataset.totals.classesHeld),
        String(dataset.totals.classesAttended),
        String(dataset.totals.present),
        String(dataset.totals.absent),
        String(dataset.totals.late),
        dataset.totals.rate === null ? "—" : `${dataset.totals.rate}%`,
      ],
    ],
    styles: { fontSize: 7.5, cellPadding: 1.6 },
    headStyles: { fillColor: [15, 92, 75], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [232, 240, 238], textColor: 20, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 250] },
    columnStyles: {
      0: { cellWidth: 7 },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
    showHead: "everyPage",
    didDrawPage: drawHeader,
    didDrawCell: () => undefined,
  });

  // ── Single-course detail: who attended what, and what was held ──
  if (dataset.course && studentRows.length > 0) {
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
      margin: { top: HEADER_HEIGHT, left: MARGIN, right: MARGIN, bottom: 14 },
      head: [["Student attendance — all registered students"]],
      body: [],
      styles: { fontSize: 9, fontStyle: "bold", cellPadding: 2 },
      theme: "plain",
      showHead: "firstPage",
      didDrawPage: drawHeader,
    });
    autoTable(doc, {
      margin: { top: HEADER_HEIGHT, left: MARGIN, right: MARGIN, bottom: 14 },
      head: [
        [
          "#",
          "Student",
          "Matric no.",
          "Present",
          "Absent",
          "Late",
          "Excused",
          "Attended",
          "Expected",
          "%",
        ],
      ],
      body: studentRows.map((student, index) => [
        String(index + 1),
        student.name,
        student.matricNo,
        String(student.present),
        String(student.absent),
        String(student.late),
        String(student.excused),
        String(student.attended),
        String(student.expected),
        `${student.percentage}%`,
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 250] },
      showHead: "everyPage",
      didDrawPage: drawHeader,
    });
  }

  if (dataset.course && lectureRows.length > 0) {
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
      margin: { top: HEADER_HEIGHT, left: MARGIN, right: MARGIN, bottom: 14 },
      head: [["Lecture", "Date", "Topic", "Expected", "Present", "Late", "Excused", "Absent", "%"]],
      body: lectureRows.map((lecture, index) => [
        String(index + 1),
        new Date(lecture.startedAt).toLocaleDateString(),
        lecture.topic ?? "—",
        String(lecture.expected),
        String(lecture.present),
        String(lecture.late),
        String(lecture.excused),
        String(lecture.absent),
        lecture.rate === null ? "—" : `${lecture.rate}%`,
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 250] },
      showHead: "everyPage",
      didDrawPage: drawHeader,
    });
  }

  // ── Sign-off block, so a printed report can be filed ──
  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor;
  let signY = finalY + 14;
  if (signY > pageHeight - 30) {
    doc.addPage();
    drawHeader();
    signY = HEADER_HEIGHT + 10;
  }
  doc.setDrawColor(180);
  doc.line(MARGIN, signY, MARGIN + 60, signY);
  doc.line(pageWidth - MARGIN - 60, signY, pageWidth - MARGIN, signY);
  doc.setFontSize(8.5);
  doc.text("Prepared by (Examinations Officer)", MARGIN, signY + 4.5);
  doc.text("Approved by (Dean / HOD)", pageWidth - MARGIN - 60, signY + 4.5);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    drawFooter({ pageNumber: page, pageCount });
  }

  doc.save(`${dataset.fileBase}.pdf`);
}
