export interface CalendarEvent {
  uid: string;
  title: string;
  startsAt: number;
  location: string;
  description: string;
  url: string;
}

// Dinners have no end time, so calendars block out an evening.
const DURATION = 3 * 60 * 60 * 1000;

const stamp = (utc: number) => new Date(utc).toISOString().replace(/[-:]|\.\d{3}/g, "");

const escape = (text: string) =>
  text.replace(/[;,\\]/g, "\\$&").replace(/\r\n|\r|\n/g, "\\n");

/** RFC 5545 limits lines to 75 bytes; longer ones continue after a space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > 75) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += character;
    size += bytes;
  }
  return [...lines, current].join("\r\n");
}

export function icsFile(event: CalendarEvent, now = Date.now()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dinner Club//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@dinner-club`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.startsAt + DURATION)}`,
    `SUMMARY:${escape(event.title)}`,
    `LOCATION:${escape(event.location)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].map(fold).join("\r\n");
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.startsAt)}/${stamp(event.startsAt + DURATION)}`,
    location: event.location,
    details: [event.description, event.url].filter(Boolean).join("\n\n"),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
