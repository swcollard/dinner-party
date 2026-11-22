/**
 * Fixed-order host rotation.
 *
 * Members have a permanent order (`position`). Each dinner records whose *turn*
 * it was (`rotationHostId`) separately from who actually hosts. That gives:
 *
 *  - Cancellation: a cancelled dinner's turn is *owed*. The next dinner scheduled
 *    goes to the owed host (oldest debt first) as a make-up, even if later dinners
 *    were already on the calendar, and nobody already scheduled is bumped.
 *  - Make-ups sit outside the regular order: they never move the pointer, so after
 *    one the rotation carries on where it was.
 *  - Override: changing who hosts a dinner changes only `host_id`; the turn is
 *    untouched, so nobody has to take a different shift.
 *  - Skip weeks: a skipped date is not a dinner and consumes no turn.
 *  - Members who leave keep their slot, so history still resolves; they are passed
 *    over, and any turn they were owed lapses.
 *
 * Everything here is pure (no I/O) so it is easy to test.
 */
export interface RotationMember {
  id: string;
  position: number;
  active: boolean;
}

export interface RotationDinner {
  id: string;
  date: string; // YYYY-MM-DD
  status: "scheduled" | "cancelled" | "done";
  rotationHostId: string | null;
  /** Set when this dinner repays a cancelled dinner's turn. */
  makeupFor: string | null;
}

export interface Turn {
  hostId: string;
  /** The cancelled dinner this turn repays, or null for a regular turn. */
  makeupFor: string | null;
}

const byDate = (a: RotationDinner, b: RotationDinner) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** Whose turn is next, or null if nobody is active. */
export function nextTurn(members: RotationMember[], dinners: RotationDinner[]): Turn | null {
  const order = [...members].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const active = new Set(order.filter((m) => m.active).map((m) => m.id));
  if (active.size === 0) return null;

  // 1. Repay cancelled turns first, oldest first. A cancelled dinner is repaid once some
  //    dinner names it in makeupFor; if that make-up is cancelled too, the make-up itself
  //    is now the unpaid debt, so the chain resolves naturally.
  const repaid = new Set(dinners.map((d) => d.makeupFor).filter((id): id is string => id !== null));
  const owed = dinners
    .filter((d) => d.status === "cancelled" && d.rotationHostId && active.has(d.rotationHostId) && !repaid.has(d.id))
    .sort(byDate)[0];
  if (owed) return { hostId: owed.rotationHostId!, makeupFor: owed.id };

  // 2. Otherwise continue the regular order after the latest regular turn. Cancelled
  //    regular dinners count here: their turn is handled by step 1, not by re-serving it.
  const last = dinners.filter((d) => d.makeupFor === null && d.rotationHostId).sort(byDate).at(-1);
  const start = last ? order.findIndex((m) => m.id === last.rotationHostId) : -1;

  // Walk forward from the last turn; wraps all the way round to the same member
  // if they are the only active one. start = -1 (no history) begins at index 0.
  for (let i = 1; i <= order.length; i++) {
    const m = order[(start + i) % order.length]!;
    if (m.active) return { hostId: m.id, makeupFor: null };
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
export function planNextDinner(p: PlanInput): ({ date: string } & Turn) | null {
  const turn = nextTurn(p.members, p.dinners);
  if (!turn) return null;
  const latest = p.dinners.reduce((max, d) => (d.date > max ? d.date : max), p.today);
  return { date: nextDinnerDate(latest, p.weekday, p.skips), ...turn };
}
