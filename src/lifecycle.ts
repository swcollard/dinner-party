import type { Env } from "./env";
import { todayIn } from "./lib/time";

/**
 * Flip scheduled dinners whose date has passed (in their group's timezone) to
 * 'done'. The SQL date filter is a safe superset across all timezones (UTC-12 to
 * UTC+14); the exact per-group check happens in code.
 */
export async function markPastDinnersDone(env: Env, now: Date): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.date, g.timezone FROM dinners d
     JOIN groups g ON g.id = d.group_id
     WHERE d.status = 'scheduled' AND d.date <= date('now')`,
  ).all<{ id: string; date: string; timezone: string }>();

  const past = results.filter((r) => r.date < todayIn(r.timezone, now));
  for (let i = 0; i < past.length; i += 50) {
    await env.DB.batch(
      past
        .slice(i, i + 50)
        .map((r) => env.DB.prepare("UPDATE dinners SET status = 'done' WHERE id = ? AND status = 'scheduled'").bind(r.id)),
    );
  }
  return past.length;
}
