/**
 * A minimal D1 stand-in for unit tests, backed by Node's built-in SQLite and the
 * real migrations, so SQL in the app (upserts, RETURNING, datetime('now')) runs as
 * written. Implements only what the app uses: prepare/bind/run/first/all and batch.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS = join(__dirname, "..", "..", "migrations");

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly args: SQLInputValue[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Statement(this.db, this.sql, args.map((a) => (a === undefined ? null : a)) as SQLInputValue[]);
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes) }, results: [] };
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args) as T[] };
  }
}

export function testDb(): { d1: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sql.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const d1 = {
    prepare: (q: string) => new Statement(sql, q),
    batch: async (stmts: Statement[]) => {
      sql.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sql.exec("COMMIT");
        return out;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, sql };
}
