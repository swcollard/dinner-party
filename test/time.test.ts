import { describe, expect, it } from "vitest";
import { daysBetween, hourIn, isValidTimezone, todayIn } from "../src/lib/time";

describe("time", () => {
  // 03:30 UTC on Sunday Nov 22 is still Saturday evening in Chicago (CST, UTC-6).
  const instant = new Date("2026-11-22T03:30:00Z");

  it("todayIn uses the group's timezone, not UTC", () => {
    expect(todayIn("UTC", instant)).toBe("2026-11-22");
    expect(todayIn("America/Chicago", instant)).toBe("2026-11-21");
  });

  it("hourIn returns the local hour", () => {
    expect(hourIn("America/Chicago", instant)).toBe(21);
    expect(hourIn("UTC", new Date("2026-11-22T00:05:00Z"))).toBe(0);
  });

  it("daysBetween counts whole days", () => {
    expect(daysBetween("2026-11-21", "2026-11-22")).toBe(1);
    expect(daysBetween("2026-11-22", "2026-11-21")).toBe(-1);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // across a DST change
  });

  it("validates timezones", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});
