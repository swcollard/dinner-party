import { type Context, Hono } from "hono";
import type { CalendarEvent } from "../domain/calendar";
import { icsFile } from "../domain/calendar";
import type { AppEnv, Dinner } from "../types";
import { absoluteUrl, neutral } from "./http";
import { loadDinner } from "./load";

export function calendarEvent(c: Context<AppEnv>, dinner: Dinner): CalendarEvent | null {
  if (dinner.status !== "confirmed" || dinner.starts_at === null) return null;
  return {
    uid: dinner.public_id,
    title: dinner.title,
    startsAt: dinner.starts_at,
    location: dinner.location,
    description: dinner.note,
    url: absoluteUrl(c, `/d/${dinner.public_id}`),
  };
}

export const calendar = new Hono<AppEnv>();

calendar.get("/d/:id/calendar.ics", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "dinner.view");
  const event = loaded && calendarEvent(c, loaded.dinner);
  if (!event) return neutral(c);
  return c.body(icsFile(event), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="dinner.ics"',
  });
});
