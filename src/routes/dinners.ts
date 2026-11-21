import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { can } from "../lib/permissions";
import { planNextDinner } from "../lib/rotation";
import { todayIn } from "../lib/time";

export const dinnerRoutes = new Hono<AppBindings>();

dinnerRoutes.get("/dinners", async (c) => {
  const { groupId, timezone } = c.get("member");
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, m.name AS host_name FROM dinners d
     JOIN members m ON m.id = d.host_id
     WHERE d.group_id = ? AND d.date >= ? ORDER BY d.date`,
  )
    .bind(groupId, todayIn(timezone, new Date()))
    .all();
  return c.json({ dinners: results });
});

// Schedule the next dinner using the fixed rotation order.
dinnerRoutes.post("/dinners/schedule-next", async (c) => {
  const me = c.get("member");
  if (!can(me, "schedule_dinners")) return c.json({ error: "forbidden" }, 403);

  const [group, members, dinners, skips] = await Promise.all([
    c.env.DB.prepare("SELECT timezone, dinner_weekday, default_start_time FROM groups WHERE id = ?")
      .bind(me.groupId)
      .first<{ timezone: string; dinner_weekday: number; default_start_time: string }>(),
    c.env.DB.prepare("SELECT id, rotation_position, active FROM members WHERE group_id = ?")
      .bind(me.groupId)
      .all<{ id: string; rotation_position: number; active: number }>(),
    c.env.DB.prepare("SELECT date, status, rotation_host_id FROM dinners WHERE group_id = ?")
      .bind(me.groupId)
      .all<{ date: string; status: "scheduled" | "cancelled" | "done"; rotation_host_id: string | null }>(),
    c.env.DB.prepare("SELECT date FROM skip_dates WHERE group_id = ?")
      .bind(me.groupId)
      .all<{ date: string }>(),
  ]);
  if (!group) return c.json({ error: "group not found" }, 404);

  const plan = planNextDinner({
    members: members.results.map((m) => ({ id: m.id, position: m.rotation_position, active: !!m.active })),
    dinners: dinners.results.map((d) => ({
      date: d.date,
      status: d.status,
      rotationHostId: d.rotation_host_id,
    })),
    skips: new Set(skips.results.map((s) => s.date)),
    weekday: group.dinner_weekday,
    today: todayIn(group.timezone, new Date()),
  });
  if (!plan) return c.json({ error: "no eligible host" }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO dinners (id, group_id, host_id, rotation_host_id, date, start_time)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, me.groupId, plan.rotationHostId, plan.rotationHostId, plan.date, group.default_start_time)
    .run();
  return c.json({ id, hostId: plan.rotationHostId, date: plan.date }, 201);
});

const rsvpBody = z.object({
  response: z.enum(["yes", "no", "maybe"]),
  guests: z.number().int().min(0).max(10).default(0),
});

dinnerRoutes.put("/dinners/:id/rsvp", async (c) => {
  const me = c.get("member");
  const body = rsvpBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  // Scope to the caller's group so RSVPs can't be written to another group's dinner.
  const dinner = await c.env.DB.prepare(
    "SELECT id FROM dinners WHERE id = ? AND group_id = ? AND status = 'scheduled'",
  )
    .bind(c.req.param("id"), me.groupId)
    .first();
  if (!dinner) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare(
    `INSERT INTO rsvps (dinner_id, member_id, response, guests) VALUES (?, ?, ?, ?)
     ON CONFLICT (dinner_id, member_id)
     DO UPDATE SET response = excluded.response, guests = excluded.guests, updated_at = datetime('now')`,
  )
    .bind(dinner.id, me.id, body.data.response, body.data.guests)
    .run();
  return c.json({ ok: true });
});
