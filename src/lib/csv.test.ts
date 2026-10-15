// CSV rules (plan P5.4 / decision D8) — the same module the Worker imports.
//
// The import is a "preview → validate → apply" workflow, so the parser's job is
// to be boring and exact: real registrar files come from Excel with a BOM, CRLF
// endings, quoted names containing commas, and a trailing blank line. Anything
// this parser gets wrong shows up as a confusing error against the wrong row.
import { describe, expect, it } from "vitest";

import { cell, escapeCell, parseCsv, toCsv } from "../../shared/csv";

describe("parseCsv", () => {
  it("reads a simple file with its line numbers", () => {
    const result = parseCsv("name,email\nAda Obi,ada@slams.edu\nBola Ade,bola@slams.edu");
    expect(result.header).toEqual(["name", "email"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: "Ada Obi", email: "ada@slams.edu" });
    // Row 1 is the header, so the first data row is line 2 — what the user sees
    // in their spreadsheet.
    expect(result.lineNumbers).toEqual([2, 3]);
    expect(result.errors).toEqual([]);
  });

  it("strips a UTF-8 BOM and handles CRLF, CR and a trailing newline", () => {
    const crlf = parseCsv("\uFEFFname,email\r\nAda Obi,ada@slams.edu\r\n");
    expect(crlf.header).toEqual(["name", "email"]);
    expect(crlf.rows).toHaveLength(1);
    const cr = parseCsv("name,email\rAda,ada@x.edu\rBola,bola@x.edu");
    expect(cr.rows).toHaveLength(2);
  });

  it("honours quoted fields with commas, quotes and newlines inside them", () => {
    const result = parseCsv('name,note\n"Obi, Ada","Said ""hello""\nthen left"\n"Bola"');
    expect(result.rows[0].name).toBe("Obi, Ada");
    expect(result.rows[0].note).toBe('Said "hello"\nthen left');
    expect(result.rows[1].name).toBe("Bola");
    // The embedded newline must not be mistaken for a row break.
    expect(result.rows).toHaveLength(2);
    expect(result.lineNumbers[1]).toBe(4);
  });

  it("trims unquoted whitespace but preserves quoted whitespace", () => {
    const result = parseCsv('name,code\n  Ada Obi , "  padded  "');
    expect(result.rows[0].name).toBe("Ada Obi");
    expect(result.rows[0].code).toBe("  padded  ");
  });

  it("reports a ragged row instead of silently truncating it", () => {
    const result = parseCsv("a,b\n1,2\n3,4,5");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].message).toContain("3 values");
    // The row still parses, so the preview can show what was understood.
    expect(result.rows[1]).toEqual({ a: "3", b: "4" });
  });

  it("pads a short row rather than shifting the columns", () => {
    const result = parseCsv("name,email,level\nAda,ada@x.edu");
    expect(result.rows[0]).toEqual({ name: "Ada", email: "ada@x.edu", level: "" });
    expect(result.errors).toEqual([]);
  });

  it("rejects an empty file and reports a duplicated column", () => {
    expect(parseCsv("").errors[0].message).toMatch(/empty/i);
    expect(parseCsv("   \n  ").errors[0].message).toMatch(/empty/i);
    const dup = parseCsv("name,Name\nAda,Ada");
    expect(dup.errors[0].message).toContain("Duplicate column");
  });
});

describe("cell lookup", () => {
  it("matches a column case-insensitively and ignores separators", () => {
    const row = { "Matric No": "CSC/22/0001", "E-mail": "ada@slams.edu" };
    expect(cell(row, "matric no")).toBe("CSC/22/0001");
    expect(cell(row, "MatricNo", "matric_no")).toBe("CSC/22/0001");
    expect(cell(row, "email")).toBe("ada@slams.edu");
    expect(cell(row, "missing")).toBe("");
  });
});

describe("writing", () => {
  it("quotes only the fields that need it", () => {
    expect(escapeCell("plain")).toBe("plain");
    expect(escapeCell("Obi, Ada")).toBe('"Obi, Ada"');
    expect(escapeCell('He said "no"')).toBe('"He said ""no"""');
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(42)).toBe("42");
  });

  it("round-trips through parseCsv", () => {
    const csv = toCsv(
      ["name", "note"],
      [
        ["Obi, Ada", 'Said "hello"'],
        ["Bola", "line\nbreak"],
      ],
    );
    const back = parseCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.rows[0]).toEqual({ name: "Obi, Ada", note: 'Said "hello"' });
    expect(back.rows[1]).toEqual({ name: "Bola", note: "line\nbreak" });
  });
});
