function offsetAt(utc: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = Date.UTC(
    get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"),
  );
  return local - Math.floor(utc / 1000) * 1000;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Converts a datetime-local value ("2027-02-06T18:30") to UTC ms, or null if it isn't a real date. */
export function localToUtc(local: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(local);
  if (!match) return null;
  const naive = Date.parse(`${local}:00Z`);
  if (Number.isNaN(naive) || new Date(naive).toISOString().slice(0, 16) !== local) return null;
  // The second pass corrects guesses that land on the other side of a clock change.
  const guess = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(guess, timeZone);
}

export function localDay(utc: number, timeZone: string): string {
  return new Date(utc + offsetAt(utc, timeZone)).toISOString().slice(0, 10);
}

/** A dinner is past once its local day is over. */
export function isPast(startsAt: number | null, timeZone: string, now = Date.now()): boolean {
  return startsAt !== null && localDay(startsAt, timeZone) < localDay(now, timeZone);
}

export function formatDateTime(utc: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(utc);
}
