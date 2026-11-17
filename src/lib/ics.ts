export interface IcsEvent {
  uid: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, floating local time
  durationMinutes?: number;
  summary: string;
  description?: string;
  location?: string;
}

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const stamp = (date: string, time: string) =>
  `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;

function addMinutes(date: string, time: string, minutes: number): string {
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15);
}

export function buildIcs(calName: string, events: IcsEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//dinner-party//EN",
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@dinner-party`,
      `DTSTAMP:${stamp(e.date, e.startTime)}`,
      `DTSTART:${stamp(e.date, e.startTime)}`,
      `DTEND:${addMinutes(e.date, e.startTime, e.durationMinutes ?? 180)}`,
      `SUMMARY:${esc(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
