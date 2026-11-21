/**
 * Fixed-order host rotation.
 *
 * Members have a permanent order (`position`). Each dinner records whose *turn*
 * it was (`rotationHostId`) separately from who actually hosts. That gives:
 *
 *  - Cancellation: a cancelled dinner is ignored, so its turn carries to the
 *    next dinner (the host "moves to next week").
 *  - Override: changing who hosts a dinner changes only `host_id`; the turn
 *    pointer is untouched, so nobody has to take a different shift.
 *  - Skip weeks: a skipped date is not a dinner and consumes no turn.
 *  - Members who leave keep their slot, so history still resolves; they are
 *    simply passed over.
 *
 * Everything here is pure (no I/O) so it is easy to test.
 */
export interface RotationMember {
  id: string;
  position: number;
  active: boolean;
}

export interface RotationDinner {
  date: string; // YYYY-MM-DD
  status: "scheduled" | "cancelled" | "done";
  rotationHostId: string | null;
}

/** Whose turn is next, or null if nobody is active. */
export function nextTurn(members: RotationMember[], dinners: RotationDinner[]): string | null {
  const order = [...members].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (!order.some((m) => m.active)) return null;

  const last = dinners
    .filter((d) => d.status !== "cancelled" && d.rotationHostId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const start = last ? order.findIndex((m) => m.id === last.rotationHostId) : -1;

  // Walk forward from the last turn; wraps all the way round to the same member
  // if they are the only active one. start = -1 (no history) begins at index 0.
  for (let i = 1; i <= order.length; i++) {
    const m = order[(start + i) % order.length]!;
    if (m.active) return m.id;
  }
  return null;
}

/** Next date (YYYY-MM-DD) falling on `weekday` (0 = Sunday) strictly after `from`. */
export function nextWeekday(from: string, weekday: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  const delta = (weekday - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Next dinner date strictly after `after`, passing over skipped weeks. */
export function nextDinnerDate(after: string, weekday: number, skips: ReadonlySet<string>): string {
  let d = nextWeekday(after, weekday);
  while (skips.has(d)) d = nextWeekday(d, weekday);
  return d;
}

export interface PlanInput {
  members: RotationMember[];
  /** Every dinner for the group, including cancelled ones. */
  dinners: RotationDinner[];
  skips: ReadonlySet<string>;
  weekday: number;
  /** Today in the group's timezone. */
  today: string;
}

/**
 * Plan the next dinner: the date follows the latest dinner on the calendar
 * (cancelled ones included, so a cancelled week is not refilled), and the turn
 * comes from `nextTurn`.
 */
export function planNextDinner(p: PlanInput): { date: string; rotationHostId: string } | null {
  const rotationHostId = nextTurn(p.members, p.dinners);
  if (!rotationHostId) return null;
  const latest = p.dinners.reduce((max, d) => (d.date > max ? d.date : max), p.today);
  return { date: nextDinnerDate(latest, p.weekday, p.skips), rotationHostId };
}
