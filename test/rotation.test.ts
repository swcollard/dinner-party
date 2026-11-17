import { describe, expect, it } from "vitest";
import { nextHost, nextWeekday } from "../src/lib/rotation";

const members = ["a", "b", "c"].map((id) => ({ id, active: true }));

describe("nextHost", () => {
  it("picks someone who has never hosted first (deterministic by id)", () => {
    expect(nextHost(members, [])).toBe("a");
  });

  it("prefers fewest hosted, then longest ago", () => {
    const history = [
      { hostId: "a", date: "2026-01-04", status: "done" as const },
      { hostId: "b", date: "2026-01-11", status: "done" as const },
      { hostId: "c", date: "2026-01-18", status: "done" as const },
      { hostId: "a", date: "2026-01-25", status: "done" as const },
    ];
    expect(nextHost(members, history)).toBe("b");
  });

  it("ignores cancelled dinners and inactive members", () => {
    const history = [{ hostId: "a", date: "2026-01-04", status: "cancelled" as const }];
    expect(nextHost([{ id: "a", active: false }, ...members.slice(1)], history)).toBe("b");
    expect(nextHost(members, history)).toBe("a");
  });

  it("supports skipping (e.g. host swapped out) and returns null if nobody left", () => {
    expect(nextHost(members, [], new Set(["a"]))).toBe("b");
    expect(nextHost(members, [], new Set(["a", "b", "c"]))).toBeNull();
  });
});

describe("nextWeekday", () => {
  it("returns the next Sunday strictly after the date", () => {
    expect(nextWeekday("2026-11-17", 0)).toBe("2026-11-22"); // Tue -> Sun
    expect(nextWeekday("2026-11-22", 0)).toBe("2026-11-29"); // Sun -> next Sun
  });
});
