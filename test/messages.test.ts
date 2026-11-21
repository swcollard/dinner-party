import { describe, expect, it } from "vitest";
import { buildMessage, dueReminders, formatDate, formatTime } from "../src/notify/messages";

const ctx = {
  groupName: "Sunday Supper",
  date: "2026-11-22",
  startTime: "18:00",
  hostName: "Alex",
  menu: "Pasta",
  chatUrl: "https://chat.whatsapp.com/xyz",
  appUrl: "https://dinner.example",
};

describe("dueReminders", () => {
  it("fires day-before and day-of", () => {
    expect(dueReminders("2026-11-22", "2026-11-21", 3)).toEqual(["day_before"]);
    expect(dueReminders("2026-11-22", "2026-11-22", 3)).toEqual(["day_of"]);
  });

  it("fires the RSVP reminder on the deadline day (dinner date minus N days)", () => {
    expect(dueReminders("2026-11-22", "2026-11-19", 3)).toEqual(["rsvp_deadline"]);
    expect(dueReminders("2026-11-22", "2026-11-18", 3)).toEqual([]);
  });

  it("sends nothing for past dinners or far-off ones", () => {
    expect(dueReminders("2026-11-22", "2026-11-23", 3)).toEqual([]);
    expect(dueReminders("2026-12-20", "2026-11-21", 3)).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats dates and times", () => {
    expect(formatDate("2026-11-22")).toBe("Sunday, Nov 22");
    expect(formatTime("18:00")).toBe("6:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
  });
});

describe("buildMessage", () => {
  it("only reveals the address when it is passed in (day-before / day-of)", () => {
    expect(buildMessage("rsvp_deadline", "Bea", ctx).text).not.toContain("1 Main St");
    const dayBefore = buildMessage("day_before", "Bea", { ...ctx, address: "1 Main St" });
    expect(dayBefore.text).toContain("Where: 1 Main St");
    expect(dayBefore.text).toContain("Menu: Pasta");
    expect(dayBefore.text).toContain("Group chat: https://chat.whatsapp.com/xyz");
    expect(dayBefore.subject).toBe("Tomorrow: dinner at Alex's");
  });

  it("tells a new host their turn carries over if they cancel", () => {
    expect(buildMessage("host_assigned", "Alex", ctx).text).toContain("carries over");
  });
});
