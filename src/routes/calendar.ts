import { Hono } from "hono";
import type { AppBindings } from "../env";
import { buildIcs } from "../lib/ics";

export const calendarRoutes = new Hono<AppBindings>();

/**
 * Calendar subscription. Calendar apps can't send headers, so the member's
 * secret calendar token is in the URL. It is separate from the access token and
 * only grants this read-only feed (which includes the host's address).
 */
calendarRoutes.get("/:token/dinners.ics", async (c) => {
  const member = await c.env.DB.prepare(
    "SELECT group_id, (SELECT name FROM groups WHERE id = group_id) AS group_name FROM members WHERE calendar_token = ? AND active = 1",
  )
    .bind(c.req.param("token"))
    .first<{ group_id: string; group_name: string }>();
  if (!member) return c.text("not found", 404);

  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.date, d.start_time, d.menu, m.name AS host_name, m.address AS host_address
     FROM dinners d JOIN members m ON m.id = d.host_id
     WHERE d.group_id = ? AND d.status = 'scheduled' AND d.date >= date('now', '-14 day')
     ORDER BY d.date`,
  )
    .bind(member.group_id)
    .all<{
      id: string;
      date: string;
      start_time: string;
      menu: string | null;
      host_name: string;
      host_address: string | null;
    }>();

  const ics = buildIcs(
    member.group_name,
    results.map((d) => ({
      uid: d.id,
      date: d.date,
      startTime: d.start_time,
      summary: `Dinner at ${d.host_name}'s`,
      description: d.menu ?? undefined,
      location: d.host_address ?? undefined,
    })),
  );
  return c.body(ics, 200, { "content-type": "text/calendar; charset=utf-8" });
});
