import { describe, expect, it } from "vitest";
import { nextDinnerDate, nextTurn, nextWeekday, planNextDinner, type RotationDinner } from "../src/lib/rotation";

const members = ["a", "b", "c"].map((id, position) => ({ id, position, active: true }));
const dinner = (
  date: string,
  rotationHostId: string,
  status: RotationDinner["status"] = "done",
  makeupFor: string | null = null,
): RotationDinner => ({ id: `d-${date}`, date, status, rotationHostId, makeupFor });
const host = (...args: Parameters<typeof nextTurn>) => nextTurn(...args)?.hostId ?? null;

describe("nextTurn: regular order", () => {
  it("starts at the first member when there is no history", () => {
    expect(nextTurn(members, [])).toEqual({ hostId: "a", makeupFor: null });
  });

  it("follows the fixed order and wraps around", () => {
    expect(host(members, [dinner("2026-11-01", "a")])).toBe("b");
    expect(host(members, [dinner("2026-11-01", "a"), dinner("2026-11-08", "b")])).toBe("c");
    expect(host(members, [dinner("2026-11-08", "c")])).toBe("a");
  });

  it("respects position, not id or insertion order", () => {
    const reordered = [
      { id: "a", position: 2, active: true },
      { id: "b", position: 0, active: true },
      { id: "c", position: 1, active: true },
    ];
    expect(host(reordered, [])).toBe("b");
    expect(host(reordered, [dinner("2026-11-01", "b")])).toBe("c");
  });

  it("does not shift anyone's turn when a host is overridden", () => {
    // It was b's turn, but c hosted instead (host_id is not part of the input at all).
    expect(host(members, [dinner("2026-11-01", "a"), dinner("2026-11-08", "b")])).toBe("c");
  });

  it("passes over inactive members, including one who was the last host", () => {
    const left = [members[0]!, { ...members[1]!, active: false }, members[2]!];
    expect(host(left, [dinner("2026-11-01", "a")])).toBe("c");
    expect(host(left, [dinner("2026-11-08", "b")])).toBe("c");
  });

  it("returns the only active member repeatedly, and null when nobody is active", () => {
    const solo = [{ id: "a", position: 0, active: true }];
    expect(host(solo, [dinner("2026-11-01", "a")])).toBe("a");
    expect(nextTurn(members.map((m) => ({ ...m, active: false })), [])).toBeNull();
  });
});

describe("nextTurn: cancelled turns are owed", () => {
  it("gives the cancelled host the next dinner, recorded as a make-up", () => {
    const history = [dinner("2026-11-01", "a"), dinner("2026-11-08", "b", "cancelled")];
    expect(nextTurn(members, history)).toEqual({ hostId: "b", makeupFor: "d-2026-11-08" });
  });

  it("repays the turn even when later dinners were already scheduled (review finding)", () => {
    const history = [
      dinner("2026-11-22", "a", "scheduled"),
      dinner("2026-11-29", "b", "cancelled"),
      dinner("2026-12-06", "c", "scheduled"),
    ];
    expect(nextTurn(members, history)).toEqual({ hostId: "b", makeupFor: "d-2026-11-29" });
  });

  it("a make-up doesn't move the pointer: the regular order resumes where it was", () => {
    const history = [
      dinner("2026-11-22", "a", "scheduled"),
      dinner("2026-11-29", "b", "cancelled"),
      dinner("2026-12-06", "c", "scheduled"),
      dinner("2026-12-13", "b", "scheduled", "d-2026-11-29"), // the make-up
    ];
    expect(nextTurn(members, history)).toEqual({ hostId: "a", makeupFor: null });
  });

  it("repays the oldest debt first when several turns are owed", () => {
    const history = [
      dinner("2026-11-01", "a"),
      dinner("2026-11-08", "b", "cancelled"),
      dinner("2026-11-15", "c", "cancelled"),
    ];
    expect(host(members, history)).toBe("b");
    expect(host(members, [...history, dinner("2026-11-22", "b", "scheduled", "d-2026-11-08")])).toBe("c");
  });

  it("if a make-up is itself cancelled, the turn is owed again", () => {
    const history = [
      dinner("2026-11-08", "b", "cancelled"),
      dinner("2026-11-15", "b", "cancelled", "d-2026-11-08"),
    ];
    expect(nextTurn(members, history)).toEqual({ hostId: "b", makeupFor: "d-2026-11-15" });
  });

  it("a turn owed to someone who has left lapses", () => {
    const left = [members[0]!, { ...members[1]!, active: false }, members[2]!];
    const history = [dinner("2026-11-01", "a"), dinner("2026-11-08", "b", "cancelled")];
    expect(nextTurn(left, history)).toEqual({ hostId: "c", makeupFor: null });
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
      hostId: "a",
      makeupFor: null,
    });
  });

  it("schedules after the latest dinner, not after today", () => {
    const dinners = [dinner("2026-11-22", "a", "scheduled")];
    expect(planNextDinner({ ...base, dinners, today: "2026-11-21" })).toMatchObject({ date: "2026-11-29", hostId: "b" });
  });

  it("moves a cancelled host to the following week", () => {
    const dinners = [dinner("2026-11-15", "a"), dinner("2026-11-22", "b", "cancelled")];
    expect(planNextDinner({ ...base, dinners, today: "2026-11-21" })).toEqual({
      date: "2026-11-29",
      hostId: "b",
      makeupFor: "d-2026-11-22",
    });
  });

  it("skips a week without consuming a turn", () => {
    const dinners = [dinner("2026-11-15", "a")];
    expect(
      planNextDinner({ ...base, dinners, skips: new Set(["2026-11-22"]), today: "2026-11-21" }),
    ).toMatchObject({ date: "2026-11-29", hostId: "b" });
  });

  it("returns null when nobody can host", () => {
    expect(planNextDinner({ ...base, members: [], dinners: [], today: "2026-11-21" })).toBeNull();
  });
});
