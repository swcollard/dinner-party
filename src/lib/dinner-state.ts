/**
 * Why a dinner can no longer be changed, or null if it is still open.
 * A dinner is open only while it is scheduled and its date has not passed in the
 * group's timezone. The hourly job later flips past dinners to 'done'; this check
 * applies immediately so there is no window where a past dinner accepts changes.
 */
export function closedReason(d: { status: string; date: string }, today: string): string | null {
  if (d.status !== "scheduled") return `dinner is ${d.status}`;
  if (d.date < today) return "dinner is in the past";
  return null;
}
