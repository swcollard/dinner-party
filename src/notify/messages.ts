import { daysBetween } from "../lib/time";
import type { Message, ReminderKind } from "./types";

export interface DinnerContext {
  groupName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  hostName: string;
  /** Only passed for messages that should reveal it (day-before / day-of). */
  address?: string | null;
  menu?: string | null;
  chatUrl?: string | null;
  appUrl: string;
}

/** Which reminders fall due on `today` for a dinner on `date` (both in the group's timezone). */
export function dueReminders(date: string, today: string, rsvpDeadlineDays: number): ReminderKind[] {
  const daysOut = daysBetween(today, date);
  const due: ReminderKind[] = [];
  if (daysOut === rsvpDeadlineDays) due.push("rsvp_deadline"); // the deadline day itself
  if (daysOut === 1) due.push("day_before");
  if (daysOut === 0) due.push("day_of");
  return due;
}

export const formatDate = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function buildMessage(kind: ReminderKind, name: string, d: DinnerContext): Message {
  const when = `${formatDate(d.date)} at ${formatTime(d.startTime)}`;
  const open = `Open your personal link to see details: ${d.appUrl}`;
  const details = [
    d.address ? `Where: ${d.address}` : null,
    d.menu ? `Menu: ${d.menu}` : null,
    d.chatUrl ? `Group chat: ${d.chatUrl}` : null,
  ].filter((x): x is string => x !== null);

  switch (kind) {
    case "host_assigned":
      return {
        subject: `You're hosting ${d.groupName} on ${formatDate(d.date)}`,
        text: [
          `Hi ${name},`,
          `It's your turn to host ${d.groupName}: ${when}.`,
          `Set the menu (or open it up as a potluck) and see who's coming. If you need to cancel, your turn carries over to the next dinner.`,
          open,
        ].join("\n\n"),
      };
    case "rsvp_deadline":
      return {
        subject: `RSVP today: ${d.groupName}, ${formatDate(d.date)}`,
        text: [`Hi ${name},`, `Please RSVP today for dinner at ${d.hostName}'s, ${when}.`, open].join("\n\n"),
      };
    case "day_before":
      return {
        subject: `Tomorrow: dinner at ${d.hostName}'s`,
        text: [`Hi ${name},`, `A reminder that ${d.groupName} is tomorrow, ${when}, at ${d.hostName}'s.`, ...details, open].join("\n\n"),
      };
    case "day_of":
      return {
        subject: `Today: dinner at ${d.hostName}'s`,
        text: [`Hi ${name},`, `${d.groupName} is today, ${when}, at ${d.hostName}'s.`, ...details, open].join("\n\n"),
      };
  }
}
