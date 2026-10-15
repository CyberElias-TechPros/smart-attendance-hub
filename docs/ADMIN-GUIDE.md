# SLAMS — Administrator's guide

Everything an institution's administrator does with SLAMS, in the order it is
usually needed. Written against the shipped build; where a screen enforces a rule,
the rule is stated as the product states it.

- [1. Who can do what](#1-who-can-do-what)
- [2. Set the institution up](#2-set-the-institution-up)
- [3. Bring your data in (CSV imports)](#3-bring-your-data-in-csv-imports)
- [4. Day-to-day attendance](#4-day-to-day-attendance)
- [5. Examinations, marks and results](#5-examinations-marks-and-results)
- [6. Access and roles](#6-access-and-roles)
- [7. Reports, exports and print](#7-reports-exports-and-print)
- [8. Freezing a semester (snapshots)](#8-freezing-a-semester-snapshots)
- [9. Backups and restore](#9-backups-and-restore)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Who can do what

| Capability                                        | Administrator | Lecturer                                   | Student |
| ------------------------------------------------- | :-----------: | ------------------------------------------ | :-----: |
| Dashboard, institution-wide figures               |      ✅       | —                                          |    —    |
| All Courses table (every course, every column)    |      ✅       | own courses only                           |    —    |
| Attendance register (every lecture)               |      ✅       | own lectures                               |    —    |
| Create/edit courses, enrolments, staff, students  |      ✅       | claim an unassigned course                 |    —    |
| Run a lecture, take attendance                    |      ✅       | own courses                                | sign in |
| Correct/void an attendance record                 |      ✅       | own course, reason required                |    —    |
| Examinations, mark entry                          |      ✅       | own course                                 |    —    |
| Publish marks to students                         |      ✅       | only with the _Publish results_ grant      |    —    |
| Reports, Excel, PDF and print                     |      ✅       | own courses                                |    —    |
| Audit trail                                       |      ✅       | only with the _View the audit trail_ grant |    —    |
| Grant capabilities, promote/demote administrators |      ✅       | —                                          |    —    |

A lecturer is limited to the courses assigned to them. Anything wider comes from a
capability an administrator grants on **Access & roles** (§6). A grant widens what
somebody may **read**; it never lets them change another lecturer's records.

## 2. Set the institution up

1. **Academic session & semester** — _Branding → Academic period_. Every course,
   lecture, mark and report is stamped with the semester in force, which is what
   makes "this semester" different from "last semester".
2. **Faculties → Departments** — _Faculties_, _Departments_. A department belongs
   to a faculty; the faculty is what a _Faculty reports_ grant resolves to.
3. **Courses** — _Courses → Add Course_. A course carries a code, title,
   department, level, units and (optionally) an assigned lecturer and category.
   _Courses → All Courses_ is the working table: filters, totals, row selection
   and the export buttons all live there.
4. **Lecturers & staff** — _Lecturers / Staff_. Create an account and place it in
   a department. A lecturer sees the courses assigned to them; unassigned courses
   in their department appear on their dashboard for them to claim.
5. **Students** — _Students_. Create individually, or import a roster (§3). Level
   and matric number are what group a cohort in reports.
6. **Timetable** — _Timetable_. Weekly series per course; SLAMS flags a genuine
   room or lecturer clash rather than silently booking it twice.

## 3. Bring your data in (CSV imports)

_Imports_ takes the spreadsheets registrars already keep. Every import is
two-step, and nothing is written until you press **Apply**.

| What            | Required columns                            | Notes                                                          |
| --------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Students        | `Name, Email, Matric No, Department, Level` | Department accepts a code (`CSC`) or a full name               |
| Lecturers/Staff | `Name, Email, Staff ID, Department`         | Email becomes the sign-in name                                 |
| Enrolments      | `Matric No`                                 | Choose the course first; already-enrolled students are skipped |
| Marks           | `Matric No, Score`                          | Choose the course **and** the assessment first                 |

- **Download the template** from the same screen — the header row it writes is
  the header the importer expects.
- **Check the file** produces a row report with **your file's line numbers**:
  _Ready_, _Skipped_ (already on the database, or repeated inside the file) and
  _Problem_ lines with the reason.
- **Duplicates are skipped, never duplicated.** Re-running yesterday's file is
  safe: nobody gets a second account, and no mark is written twice.
- **A problem row stops the whole file.** Imports are applied as one transaction,
  so a file with one bad row writes nothing at all — fix the row, check again,
  apply.
- Imported people get a generated password (`student-ab12`, `staff-ab12`) unless
  you supply one. They can change it from _Settings_.
- Every applied import is recorded in the audit trail with the counts.

## 4. Day-to-day attendance

- A lecturer starts a lecture and reads out (or displays) the six-digit code;
  students sign in from any phone, or the lecturer records a manual status.
- **Closing a lecture materialises the absences**, so present + late + excused +
  absent always reconciles with the roster. A lecture left open shows as pending
  rather than as an absence.
- **Corrections** (_Attendance → a lecture → a record_) require a reason, are
  attributed to the person who made them, notify the affected student, and append
  a row to the audit trail. There is no silent edit path.
- **Attendance & roles** — the register (_Attendance_) lists every lecture with
  the same tallies and the same weighted percentage as the course pages.
- **Rate limits and locked periods** — a finalised semester refuses new sessions
  and corrections unless an administrator explicitly overrides with a reason.

### What the percentages mean

- A student's percentage is `(present + late) ÷ expected lectures × 100`, where
  _expected_ counts the lectures they were enrolled for and which actually ran.
- A course, department, faculty or institution percentage is
  `Σ attended ÷ Σ expected × 100` — aggregates over attendance opportunities, never
  an average of course percentages. Two courses with different enrolments and
  different lecture counts cannot distort it.
- **Excused** counts as absent by default and **late** counts as attended; both
  are shown separately so a policy can change without rewriting history.
- An em-dash (`—`) means there is nothing to divide (no lectures, or an empty
  roster) — never a zero.

## 5. Examinations, marks and results

- **Examinations** — add the assessments for a course (continuous assessment,
  test, examination, practical) with their own **maximum score**. A mark is stored
  as a score against that maximum, never as a bare percentage, so re-weighting a
  paper cannot silently change a published grade.
- **Mark entry** is a grid over the roster: type the marks, save once. _Fill full
  marks_ and _Clear all_ are there for the common cases; the class average updates
  as you type.
- **Publishing** releases marks to students. An administrator can always publish;
  a lecturer needs the _Publish results_ capability, and can never un-publish a
  bad result to hide it.
- **Results** — attendance × performance for one course: the correlation between
  attendance and marks, the students below the attendance threshold, and the
  cohort split. A script that has not been marked is **excluded from every
  average** rather than counted as a zero, and is listed as unmarked.
- **Barred-from-exam policy** — off by default. With the policy off the page still
  reports how many students are under the threshold and how many of those would
  pass; switching the policy on (_Branding → Settings_) is what makes SLAMS assert
  the consequence.

## 6. Access and roles

_Access & roles_ is one grid: staff down the side, capabilities across the top, a
switch at each intersection. Every switch is a capability the API checks
server-side.

| Capability               | What it widens                                         |
| ------------------------ | ------------------------------------------------------ |
| Department reports       | Reading/exporting every course in their own department |
| Faculty reports          | Reading/exporting their whole faculty                  |
| Institution-wide reports | Reading/exporting every course in the institution      |
| Publish results          | Releasing marks to students for the courses they teach |
| Import people            | Bulk-creating students, staff and enrolments from CSV  |
| View the audit trail     | Reading the append-only log                            |

- **Grants are additive.** A lecturer trusted with a department still sees the
  service course they teach in another department.
- **A request can only narrow, never widen.** The scope is applied on the server
  after the filters you typed, so a hand-edited query string cannot reach another
  department's data.
- **Promoting a lecturer to administrator** gives full access and revokes their
  outstanding sessions (they sign in again). The change is audited.
- **The last administrator can never be demoted** — promote somebody else first.
- Every grant and revocation records who made it and when, and appears in the
  audit trail. Removing the grant removes the access, not the history.

## 7. Reports, exports and print

- **Filters first.** Academic session, semester, faculty, department, course,
  lecturer, date range and attendance status all apply to the table _and_ to
  whatever you export. The URL carries the filters, so a filtered view can be
  pasted into an email and opened by a colleague with the same permissions.
- **Select rows** to export a subset; with nothing selected the exports cover
  everything the filters allow.
- **Excel** produces one workbook: a summary sheet plus per-course sheets with the
  lecture rows and the student rows behind the figures.
- **Print / PDF** produces the same report on A4 with the institution name and
  logo, the title, session and semester, the filters in force, the totals,
  present/absent/late counts, percentages and averages, the generation date, and
  repeated table headers on every page (`Page x of y`).
- **Exports are recorded.** Finishing an export writes an audit row with the
  format, scope and row count, so "who took the attendance data out, and with
  which filters?" is answerable.

## 8. Freezing a semester (snapshots)

Finalising a semester (_Branding → Academic period_) freezes its attendance
records **and** stores the published report payload as a snapshot. Re-printing
last year's semester report therefore reproduces the numbers that were published,
even after a correction or a change to the at-risk threshold. Snapshots are listed
with the report they froze; the figures inside are the ones that were official.

## 9. Backups and restore

Cloudflare D1 keeps 30 days of point-in-time history (Time Travel). The runbook —
including a documented restore drill and what to check afterwards — is in
[DEPLOY.md § Backups and restore](../DEPLOY.md#backups-and-restore). Two habits
worth adopting:

- Export a report or workbook at the end of every semester and archive it. A
  snapshot plus an exported PDF is a complete, human-readable record.
- Before a bulk import that touches hundreds of rows, note the time. Restoring to
  a point before that time is one command (see the runbook).

## 10. Troubleshooting

| Symptom                                            | Cause and fix                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A lecturer sees fewer courses than expected        | They are limited to their assigned courses; grant _Department reports_ or assign more courses.     |
| The import preview shows a _Problem_ on a good row | Check the department code and the matric number; the message names the offending column.           |
| Marks are missing from the class average           | An unmarked script is excluded from averages by design; mark it to include it.                     |
| A course shows `—` for attendance                  | No lectures were held in the selected window (or the roster is empty) — filter a wider date range. |
| Results are invisible to students                  | The paper is unpublished; publish it (or grant _Publish results_ to the lecturer).                 |
| "The last administrator cannot be demoted"         | Promote another staff member to administrator first.                                               |
| Exports are empty for a colleague                  | Their role or grants do not cover the courses in the filtered view.                                |
