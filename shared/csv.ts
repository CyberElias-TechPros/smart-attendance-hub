// CSV parsing and writing for the bulk imports (plan P5.4 / decision D8).
//
// Written here rather than pulled from a dependency for three reasons: the rules
// are small and fully specified by RFC 4180; the preview→validate→apply flow needs
// row *numbers* to point the user at the offending line; and a spreadsheet export
// the registrar already has must import without being reformatted first.
//
// What it handles because real files contain it:
//   * quoted fields, including embedded commas, newlines and doubled quotes;
//   * CRLF and CR line endings, and a UTF-8 BOM (Excel writes one);
//   * ragged rows (short rows are padded, long rows are reported, never silently
//     truncated);
//   * a header row in any order, matched case-insensitively and trimmed.

export interface CsvParseResult {
  /** Header names as they appeared, trimmed. */
  header: string[];
  /** One object per data row, keyed by header name. */
  rows: Array<Record<string, string>>;
  /** 1-based *file* line numbers for each row, for error messages. */
  lineNumbers: number[];
  /** Structural problems (ragged rows, duplicate headers, empty file). */
  errors: Array<{ line: number; message: string }>;
}

/** Split CSV text into a header and rows, keeping track of source line numbers. */
export function parseCsv(text: string): CsvParseResult {
  const errors: CsvParseResult["errors"] = [];
  // Excel writes a BOM; left in place it becomes part of the first header name.
  const clean = text.replace(/^\uFEFF/, "");
  if (clean.trim() === "") {
    return {
      header: [],
      rows: [],
      lineNumbers: [],
      errors: [{ line: 1, message: "The file is empty" }],
    };
  }

  const records: Array<{ fields: string[]; line: number }> = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawQuoteInField = false;

  const endField = () => {
    fields.push(sawQuoteInField ? field : field.trim());
    field = "";
    sawQuoteInField = false;
  };
  const endRecord = () => {
    endField();
    // Skip blank lines (a trailing newline is not a row).
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ fields, line: recordLine });
    }
    fields = [];
    recordLine = line;
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      // A quote only *opens* a quoted section at the start of a field (allowing
      // for whitespace a spreadsheet may have padded it with). Anywhere else it
      // is a literal quote, which is what keeps a stray apostrophe-like `"`
      // inside an unquoted name from swallowing the rest of the file.
      if (field.trim() === "" && !sawQuoteInField) {
        field = "";
        inQuotes = true;
        sawQuoteInField = true;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === ",") {
      endField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      line++;
      endRecord();
      recordLine = line;
      continue;
    }
    field += ch;
  }
  if (field !== "" || fields.length > 0 || sawQuoteInField) endRecord();

  if (records.length === 0) {
    return {
      header: [],
      rows: [],
      lineNumbers: [],
      errors: [{ line: 1, message: "The file is empty" }],
    };
  }

  const header = records[0].fields.map((h) => h.trim());
  const seen = new Set<string>();
  for (const name of header) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      errors.push({ line: records[0].line, message: `Duplicate column "${name}"` });
    }
    seen.add(key);
  }

  const rows: Array<Record<string, string>> = [];
  const lineNumbers: number[] = [];
  for (const record of records.slice(1)) {
    if (record.fields.length > header.length) {
      errors.push({
        line: record.line,
        message: `Row has ${record.fields.length} values but the header has ${header.length}`,
      });
    }
    const row: Record<string, string> = {};
    header.forEach((name, index) => {
      row[name] = record.fields[index] ?? "";
    });
    rows.push(row);
    lineNumbers.push(record.line);
  }

  return { header, rows, lineNumbers, errors };
}

/** Case-insensitive, whitespace-tolerant cell lookup. */
export function cell(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const wanted = name.toLowerCase().replace(/[\s_-]+/g, "");
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase().replace(/[\s_-]+/g, "") === wanted) {
        return typeof value === "string" ? value.trim() : "";
      }
    }
  }
  return "";
}

/** Quote a field when it would otherwise break the format. */
export function escapeCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document from a header and rows (used for the templates). */
export function toCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return [header.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join(
    "\r\n",
  );
}
