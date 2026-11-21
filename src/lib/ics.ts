export interface IcsEvent {
  uid: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, floating local time
  durationMinutes?: number;
  summary: string;
  description?: string;
  location?: string;
}

// Built from a code point so the intended single backslash is unambiguous in source.
const BACKSLASH = "\u005c";

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export const escapeText = (s: string): string =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll(";", BACKSLASH + ";")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/g, "\\n");

const enc = new TextEncoder();

/**
 * RFC 5545 line folding: content lines must be at most 75 octets (excluding the
 * CRLF); longer lines continue on the next line after one space. Folding is by
 * UTF-8 octets and never splits a multi-byte character.
 */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75; // continuation lines lose one octet to the leading space
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;

/** UTC timestamp, e.g. 20261121T193000Z (used for DTSTAMP: when the feed was generated). */
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function addMinutes(date: string, time: string, minutes: number): string {
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15);
}

export function buildIcs(calName: string, events: IcsEvent[], now: Date = new Date()): string {
  const dtstamp = utcStamp(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dinner-party//EN", `X-WR-CALNAME:${escapeText(calName)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@dinner-party`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.date, e.startTime)}`,
      `DTEND:${addMinutes(e.date, e.startTime, e.durationMinutes ?? 180)}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
