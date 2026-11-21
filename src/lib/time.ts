/** Timezone helpers. Dates are plain YYYY-MM-DD strings in the group's timezone. */

/** Today's date in `tz` (e.g. "America/Chicago"), as YYYY-MM-DD. */
export function todayIn(tz: string, now: Date): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Current hour (0-23) in `tz`. */
export function hourIn(tz: string, now: Date): number {
  return Number.parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now),
    10,
  );
}

/** Whole days from `a` to `b` (b - a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
