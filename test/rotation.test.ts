import { describe, expect, it } from "vitest";
import { nextDinnerDate, nextTurn, nextWeekday, planNextDinner } from "../src/lib/rotation";

const members = ["a", "b", "c"].map((id, position) => ({ id, position, active: true }));
const dinner = (date: string, rotationHostId: string, status: "scheduled" | "cancelled" | "done" = "done") => ({
  date,
  status,
  rotationHostId,
});

describe("nextTurn", () => {
  it("starts at the first member when there is no history", () => {
    expect(nextTurn(members, [])).toBe("a");
  });

  it("follows the fixed order and wraps around", () => {
    expect(nextTurn(members, [dinner("2026-11-01", "a")])).toBe("b");
    expect(nextTurn(members, [dinner("2026-11-01", "a"), dinner("2026-11-08", "b")])).toBe("c");
    expect(nextTurn(members, [dinner("2026-11-08", "c")])).toBe("a");
  });

  it("respects position, not id or insertion order", () => {
    const reordered = [
      { id: "a", position: 2, active: true },
      { id: "b", position: 0, active: true },
      { id: "c", position: 1, active: true },
    ];
    expect(nextTurn(reordered, [])).toBe("b");
    expect(nextTurn(reordered, [dinner("2026-11-01", "b")])).toBe("c");
  });

  it("carries a cancelled dinner's turn to the next dinner", () => {
    const history = [dinner("2026-11-01", "a"), dinner("2026-11-08", "b", "cancelled")];
    expect(nextTurn(members, history)).toBe("b");
  });

  it("does not shift anyone's turn when a host is overridden", () => {
    // It was b's turn, but c hosted instead (host_id is not part of the input at all).
    expect(nextTurn(members, [dinner("2026-11-01", "a"), dinner("2026-11-08", "b")])).toBe("c");
  });

  it("passes over inactive members, including one who was the last host", () => {
    const left = [members[0]!, { ...members[1]!, active: false }, members[2]!];
    expect(nextTurn(left, [dinner("2026-11-01", "a")])).toBe("c");
    expect(nextTurn(left, [dinner("2026-11-08", "b")])).toBe("c");
  });

  it("returns the only active member repeatedly, and null when nobody is active", () => {
    const solo = [{ id: "a", position: 0, active: true }];
    expect(nextTurn(solo, [dinner("2026-11-01", "a")])).toBe("a");
    expect(nextTurn(members.map((m) => ({ ...m, active: false })), [])).toBeNull();
  });
});

describe("dates", () => {
  it("nextWeekday is strictly after the given date", () => {
    expect(nextWeekday("2026-11-17", 0)).toBe("2026-11-22"); // Tue -> Sun
    expect(nextWeekday("2026-11-22", 0)).toBe("2026-11-29"); // Sun -> next Sun
  });

  it("nextDinnerDate passes over skipped weeks", () => {
    expect(nextDinnerDate("2026-11-17", 0, new Set(["2026-11-22"]))).toBe("2026-11-29");
    expect(nextDinnerDate("2026-11-17", 0, new Set(["2026-11-22", "2026-11-29"]))).toBe("2026-12-06");
  });
});

describe("planNextDinner", () => {
  const base = { members, skips: new Set<string>(), weekday: 0 };

  it("plans the first dinner on the next Sunday for the first member", () => {
    expect(planNextDinner({ ...base, dinners: [], today: "2026-11-21" })).toEqual({
      date: "2026-11-22",
      rotationHostId: "a",
    });
  });

  it("schedules after the latest dinner, not after today", () => {
    const dinners = [dinner("2026-11-22", "a", "scheduled")];
    expect(planNextDinner({ ...base, dinners, today: "2026-11-21" })).toEqual({
      date: "2026-11-29",
      rotationHostId: "b",
    });
  });

  it("moves a cancelled host to the following week", () => {
    const dinners = [dinner("2026-11-15", "a"), dinner("2026-11-22", "b", "cancelled")];
    expect(planNextDinner({ ...base, dinners, today: "2026-11-21" })).toEqual({
      date: "2026-11-29",
      rotationHostId: "b",
    });
  });

  it("skips a week without consuming a turn", () => {
    const dinners = [dinner("2026-11-15", "a")];
    expect(
      planNextDinner({ ...base, dinners, skips: new Set(["2026-11-22"]), today: "2026-11-21" }),
    ).toEqual({ date: "2026-11-29", rotationHostId: "b" });
  });

  it("returns null when nobody can host", () => {
    expect(
      planNextDinner({ ...base, members: [], dinners: [], today: "2026-11-21" }),
    ).toBeNull();
  });
});
