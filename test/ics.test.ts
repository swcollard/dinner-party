import { describe, expect, it } from "vitest";
import { buildIcs } from "../src/lib/ics";

describe("buildIcs", () => {
  it("emits a valid calendar with escaped text and CRLF endings", () => {
    const ics = buildIcs("Dinner Party", [
      { uid: "1", date: "2026-11-22", startTime: "18:00", summary: "Dinner, at Sam's; yum" },
    ]);
    expect(ics).toContain("DTSTART:20261122T180000");
    expect(ics).toContain("DTEND:20261122T210000");
    expect(ics).toContain("SUMMARY:Dinner\\, at Sam's\; yum");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
