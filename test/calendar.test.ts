import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile } from "../src/domain/calendar";
import { bindings, Browser, seed } from "./helpers";

const event = {
  uid: "abc",
  title: "Soup; stew, & more",
  startsAt: Date.parse("2027-02-07T00:30:00Z"),
  location: "Ana's",
  description: `Line one\r\nEND:VEVENT ${"é".repeat(60)}`,
  url: "https://dinner.test/d/abc",
};

describe("calendar", () => {
  it("escapes text, keeps UTC times and a stable id", () => {
    const ics = icsFile(event, 0);
    expect(ics).toContain("UID:abc@dinner-club\r\n");
    expect(ics).toContain("DTSTART:20270207T003000Z\r\nDTEND:20270207T033000Z");
    expect(ics).toContain(["SUMMARY:Soup", "; stew", ", & more"].join("\\"));
    const backslash = "\\";
    expect(icsFile({ ...event, title: `a${backslash}b` })).toContain(`SUMMARY:a${backslash}${backslash}b`);
    expect(ics.match(/^END:VEVENT/gm)).toHaveLength(1);
  });
  it("folds lines to 75 bytes without losing text", () => {
    const ics = icsFile(event, 0);
    expect(Math.max(...ics.split("\r\n").map((l) => new TextEncoder().encode(l).length))).toBeLessThanOrEqual(75);
    expect(ics.replaceAll("\r\n ", "")).toContain("é".repeat(60));
  });
  it("links to Google Calendar", () => {
    const params = new URL(googleCalendarUrl(event)).searchParams;
    expect(params.get("dates")).toBe("20270207T003000Z/20270207T033000Z");
    expect(params.get("text")).toBe(event.title);
  });
  it("is offered only for confirmed dinners, to people who can see them", async () => {
    const { bo, dinner } = await seed();
    const file = await bo.get(`${dinner}/calendar.ics`);
    expect(file.headers.get("Content-Type")).toContain("text/calendar");
    expect(file.body).toContain("SUMMARY:Soup night");
    expect(file.body).not.toMatch(/\/[ki]\//);
    expect((await new Browser().get(`${dinner}/calendar.ics`)).status).toBe(404);
    await bindings.DB.prepare("UPDATE dinners SET status = 'cancelled'").run();
    expect((await bo.get(`${dinner}/calendar.ics`)).status).toBe(404);
    expect((await bo.get(dinner)).body).not.toContain("calendar.ics");
  });
});
