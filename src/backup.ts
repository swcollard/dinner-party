import type { Env } from "./env";

/** Weekly, Sundays 09:00 UTC. Must match the second cron in wrangler.jsonc. */
export const BACKUP_CRON = "0 9 * * 0";

const PAGE_SIZE = 1000;

/**
 * Columns never written to backups because they are live secrets. A calendar token is a
 * bearer credential for a feed that includes host addresses, so anyone with read access to
 * the bucket could use it. (Access tokens are already stored only as hashes.) After a restore,
 * mint fresh ones; members re-subscribe from the calendar URL in the app:
 *   UPDATE members SET calendar_token = lower(hex(randomblob(32)));
 */
export const REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  members: ["calendar_token"],
};

const quote = (ident: string) => `"${ident.replaceAll('"', '""')}"`;

/**
 * Export every table to R2 as newline-delimited JSON, plus the schema and a manifest.
 *
 *   backups/YYYY-MM-DD/<table>.ndjson
 *   backups/YYYY-MM-DD/schema.sql
 *   backups/YYYY-MM-DD/manifest.json   <- written last: a backup without one is incomplete
 *
 * Tables are discovered from sqlite_master so new migrations are backed up
 * automatically. Data is tiny at friend-group scale, so each table is buffered in memory.
 * D1 Time Travel gives point-in-time restore for the last 30 days; this is the
 * long-term, portable copy. Expire old backups with an R2 lifecycle rule.
 */
export async function runBackup(env: Env, now: Date): Promise<{ day: string; tables: Record<string, number> }> {
  const day = now.toISOString().slice(0, 10);
  const prefix = `backups/${day}`;

  const { results: tables } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'
     ORDER BY name`,
  ).all<{ name: string }>();

  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const lines: string[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${quote(name)} ORDER BY rowid LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      ).all();
      const redact = REDACTED_COLUMNS[name] ?? [];
      for (const row of results) {
        for (const col of redact) if (col in row) (row as Record<string, unknown>)[col] = null;
        lines.push(JSON.stringify(row));
      }
      if (results.length < PAGE_SIZE) break;
    }
    await env.BACKUPS.put(`${prefix}/${name}.ndjson`, lines.map((l) => `${l}\n`).join(""), {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
    counts[name] = lines.length;
  }

  const { results: schema } = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY rowid",
  ).all<{ sql: string }>();
  await env.BACKUPS.put(`${prefix}/schema.sql`, schema.map((s) => `${s.sql};\n`).join("\n"));

  await env.BACKUPS.put(
    `${prefix}/manifest.json`,
    JSON.stringify({ createdAt: now.toISOString(), tables: counts, redacted: REDACTED_COLUMNS }, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );
  return { day, tables: counts };
}
