import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine } from "../src/lib/ics";

const unfold = (s: string) => s.replace(/\r\n /g, "");
const NOW = new Date("2026-11-21T19:30:05.123Z");

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and newlines per RFC 5545", () => {
    // Expected values are written as raw strings so the backslashes are visible.
    expect(escapeText("a;b")).toBe(String.raw`a\;b`);
    expect(escapeText("a,b")).toBe(String.raw`a\,b`);
    expect(escapeText("a\\b")).toBe(String.raw`a\\b`);
    expect(escapeText("line1\nline2\r\nline3")).toBe(String.raw`line1\nline2\nline3`);
    expect(escapeText("1 Main St; Apt 2, Austin")).toBe(String.raw`1 Main St\; Apt 2\, Austin`);
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines to at most 75 octets and unfolds back to the original", () => {
    const line = "DESCRIPTION:" + "word ".repeat(60);
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(line);
  });

  it("never splits a multi-byte character", () => {
    const line = "SUMMARY:" + "é🍝".repeat(40);
    const folded = foldLine(line);
    expect(unfold(folded)).toBe(line);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }
  });
});

describe("buildIcs", () => {
  const ics = buildIcs(
    "Dinner Party",
    [
      {
        uid: "1",
        date: "2026-11-22",
        startTime: "18:00",
        summary: "Dinner, at Sam's; yum",
        location: "1 Main St; Apt 2",
        description: "Menu: " + "pasta, ".repeat(30),
      },
    ],
    NOW,
  );

  it("escapes text and uses CRLF line endings", () => {
    expect(ics).toContain(String.raw`SUMMARY:Dinner\, at Sam's\; yum`);
    expect(ics).toContain(String.raw`LOCATION:1 Main St\; Apt 2`);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("stamps DTSTAMP with the generation time in UTC, not the event date", () => {
    expect(ics).toContain("DTSTAMP:20261121T193005Z");
    expect(ics).toContain("DTSTART:20261122T180000");
    expect(ics).toContain("DTEND:20261122T210000");
  });

  it("folds long lines", () => {
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain("DESCRIPTION:Menu: pasta\\, pasta\\,");
  });
});
