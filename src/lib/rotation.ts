/**
 * Fairness-weighted host rotation.
 *
 * Pick the active member who has hosted the fewest times; break ties by who
 * hosted longest ago (never-hosted counts as longest ago); then by id so the
 * result is deterministic. Pure function: no I/O, easy to test.
 */
export interface RotationMember {
  id: string;
  active: boolean;
}

export interface PastDinner {
  hostId: string;
  date: string; // YYYY-MM-DD
  status: "scheduled" | "cancelled" | "done";
}

export function nextHost(
  members: RotationMember[],
  history: PastDinner[],
  skip: ReadonlySet<string> = new Set(),
): string | null {
  // Cancelled dinners don't count as hosting.
  const counted = history.filter((d) => d.status !== "cancelled");

  const stats = new Map<string, { count: number; last: string }>();
  for (const d of counted) {
    const s = stats.get(d.hostId) ?? { count: 0, last: "" };
    s.count += 1;
    if (d.date > s.last) s.last = d.date;
    stats.set(d.hostId, s);
  }

  const candidates = members.filter((m) => m.active && !skip.has(m.id));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const sa = stats.get(a.id) ?? { count: 0, last: "" };
    const sb = stats.get(b.id) ?? { count: 0, last: "" };
    return (
      sa.count - sb.count ||
      sa.last.localeCompare(sb.last) || // "" (never) sorts first
      a.id.localeCompare(b.id)
    );
  });
  return candidates[0]!.id;
}

/** Next date (YYYY-MM-DD) falling on `weekday` (0=Sun) strictly after `from`. */
export function nextWeekday(from: string, weekday: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  const delta = ((weekday - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
