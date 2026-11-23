export interface Seat {
  id: number;
  invitation_id: number;
  person_id: number | null;
  queued_at: number;
}

/** First come, first seated. People who tie go ahead of plus-ones, who have no person_id. */
export function assignSeats<T extends Seat>(wanted: T[], capacity: number | null): { seated: T[]; waitlist: T[] } {
  const queue = [...wanted].sort(
    (a, b) =>
      a.queued_at - b.queued_at ||
      Number(a.person_id === null) - Number(b.person_id === null) ||
      a.id - b.id,
  );
  const limit = capacity ?? queue.length;
  return { seated: queue.slice(0, limit), waitlist: queue.slice(limit) };
}
