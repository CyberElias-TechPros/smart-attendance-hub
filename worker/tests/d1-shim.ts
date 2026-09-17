// D1 test shim: implements the narrow D1Database surface (see worker/src/db.ts)
// on top of node:sqlite, so the repository and the full HTTP handler can be
// integration-tested against real SQLite without a Cloudflare account.
//
// D1 and node:sqlite share the SQLite dialect, so this exercises the same SQL
// the production worker runs.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { D1Database, D1PreparedStatement } from "../src/db";

export interface D1Shim {
  db: D1Database;
  raw: DatabaseSync;
  close(): void;
}

export function createD1Shim(): D1Shim {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");

  const db: D1Database = {
    prepare(sql: string): D1PreparedStatement {
      const stmt: StatementSync = raw.prepare(sql);
      type SqlValue = null | number | bigint | string | Uint8Array;
      let params: SqlValue[] = [];
      const self: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values as SqlValue[];
          return self;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          return { results: stmt.all(...params) as T[] };
        },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          const r = stmt.get(...params);
          return (r ?? null) as T | null;
        },
        async run(): Promise<{ success: boolean; meta: unknown }> {
          const res = stmt.run(...params);
          return {
            success: true,
            // node:sqlite run() returns { changes, lastInsertRowid } — surface
            // `changes` the way D1's meta does so callers can count affected rows.
            meta: { changes: res.changes, last_row_id: res.lastInsertRowid },
          };
        },
      };
      return self;
    },
  };

  return { db, raw, close: () => raw.close() };
}

/** Apply all migrations (in filename order), like `wrangler d1 migrations apply`. */
export function applyMigrations(raw: DatabaseSync, migrationsDir = "migrations"): void {
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}
