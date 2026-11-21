import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { closedReason } from "../lib/dinner-state";
import { can, canCancelDinner, canEditDinner } from "../lib/permissions";
import { planNextDinner } from "../lib/rotation";
import { todayIn } from "../lib/time";
import { updateStatement } from "../lib/sql";
import { notifyHostAssigned } from "../notify/reminders";

export const dinnerRoutes = new Hono<AppBindings>();

dinnerRoutes.get("/dinners", async (c) => {
  const { id, groupId, timezone } = c.get("member");
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, m.name AS host_name,
            (SELECT response FROM rsvps WHERE dinner_id = d.id AND member_id = ?) AS my_response
     FROM dinners d
     JOIN members m ON m.id = d.host_id
     WHERE d.group_id = ? AND d.date >= ? ORDER BY d.date`,
  )
    .bind(id, groupId, todayIn(timezone, new Date()))
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
  c.executionCtx.waitUntil(notifyHostAssigned(c.env, id));
  return c.json({ id, hostId: plan.rotationHostId, date: plan.date }, 201);
});

export interface DinnerRow {
  id: string;
  host_id: string;
  rotation_host_id: string | null;
  date: string;
  start_time: string;
  menu: string | null;
  notes: string | null;
  menu_mode: "host" | "potluck" | "both";
  status: "scheduled" | "cancelled" | "done";
  cancel_reason: string | null;
  host_name: string;
  host_address: string | null;
}

/** Fetch a dinner, scoped to the caller's group so ids from other groups look nonexistent. */
export const findDinner = (db: D1Database, id: string, groupId: string) =>
  db
    .prepare(
      `SELECT d.*, h.name AS host_name, h.address AS host_address
       FROM dinners d JOIN members h ON h.id = d.host_id
       WHERE d.id = ? AND d.group_id = ?`,
    )
    .bind(id, groupId)
    .first<DinnerRow>();

dinnerRoutes.get("/dinners/:id", async (c) => {
  const me = c.get("member");
  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);

  const [rsvps, guests, dishes, group] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.member_id, m.name, m.dietary, r.response FROM rsvps r
       JOIN members m ON m.id = r.member_id WHERE r.dinner_id = ? ORDER BY m.name`,
    )
      .bind(d.id)
      .all<{ member_id: string; name: string; dietary: string | null; response: string }>(),
    c.env.DB.prepare(
      "SELECT id, name, dietary, response, invited_by FROM guests WHERE dinner_id = ? ORDER BY created_at",
    )
      .bind(d.id)
      .all<{ id: string; name: string; dietary: string | null; response: string; invited_by: string }>(),
    c.env.DB.prepare(
      `SELECT x.id, x.member_id, m.name AS member_name, x.course, x.description, x.dietary_notes
       FROM dishes x JOIN members m ON m.id = x.member_id WHERE x.dinner_id = ? ORDER BY x.created_at`,
    )
      .bind(d.id)
      .all(),
    c.env.DB.prepare("SELECT chat_url FROM groups WHERE id = ?").bind(me.groupId).first<{ chat_url: string | null }>(),
  ]);

  // Allergy data is sensitive: only the host and people who can edit any dinner see everyone's.
  const seeDietary = canEditDinner(me, d.host_id);
  const attending = (r: string) => r === "yes" || r === "maybe";
  const dietary = seeDietary
    ? [
        ...rsvps.results.filter((r) => attending(r.response)).map((r) => ({ name: r.name, dietary: r.dietary })),
        ...guests.results.filter((g) => attending(g.response)).map((g) => ({ name: g.name, dietary: g.dietary })),
      ].filter((x) => x.dietary && x.dietary.trim().toLowerCase() !== "none")
    : undefined;

  return c.json({
    id: d.id,
    date: d.date,
    startTime: d.start_time,
    status: d.status,
    cancelReason: d.cancel_reason,
    menuMode: d.menu_mode,
    menu: d.menu,
    notes: d.notes,
    host: { id: d.host_id, name: d.host_name },
    // Only shown while the dinner is still on (not cancelled, done or past); every caller is a group member.
    address: closedReason(d, todayIn(me.timezone, new Date())) === null ? d.host_address : null,
    chatUrl: group?.chat_url ?? null,
    headcount:
      rsvps.results.filter((r) => r.response === "yes").length +
      guests.results.filter((g) => g.response === "yes").length,
    rsvps: rsvps.results.map((r) => ({ memberId: r.member_id, name: r.name, response: r.response })),
    guests: guests.results.map((g) => ({ id: g.id, name: g.name, response: g.response, invitedBy: g.invited_by })),
    dishes: dishes.results,
    dietary,
  });
});

const dinnerPatch = z.object({
  menu: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  menuMode: z.enum(["host", "potluck", "both"]).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

// The host (or anyone allowed to edit any dinner) sets the menu, notes, time and menu style.
dinnerRoutes.put("/dinners/:id", async (c) => {
  const me = c.get("member");
  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);
  if (!canEditDinner(me, d.host_id)) return c.json({ error: "forbidden" }, 403);
  const closed = closedReason(d, todayIn(me.timezone, new Date()));
  if (closed) return c.json({ error: closed }, 409);

  const body = dinnerPatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const stmt = updateStatement(
    c.env.DB,
    "dinners",
    { menu: "menu", notes: "notes", menuMode: "menu_mode", startTime: "start_time" },
    body.data,
    "id = ?",
    [d.id],
  );
  if (stmt) await stmt.run();
  return c.json({ ok: true });
});

// Override who hosts this dinner. Only host_id changes: the rotation turn stays
// with rotation_host_id, so nobody has to take a different shift.
dinnerRoutes.put("/dinners/:id/host", async (c) => {
  const me = c.get("member");
  if (!can(me, "override_host")) return c.json({ error: "forbidden" }, 403);
  const body = z.object({ hostId: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);
  const closed = closedReason(d, todayIn(me.timezone, new Date()));
  if (closed) return c.json({ error: closed }, 409);
  const host = await c.env.DB.prepare("SELECT id FROM members WHERE id = ? AND group_id = ? AND active = 1")
    .bind(body.data.hostId, me.groupId)
    .first();
  if (!host) return c.json({ error: "host must be an active member of the group" }, 400);

  await c.env.DB.prepare("UPDATE dinners SET host_id = ? WHERE id = ?").bind(body.data.hostId, d.id).run();
  c.executionCtx.waitUntil(notifyHostAssigned(c.env, d.id));
  return c.json({ ok: true, hostId: body.data.hostId, rotationHostId: d.rotation_host_id });
});

// Cancel a dinner. The host's turn carries over: the next scheduled dinner goes to them.
dinnerRoutes.post("/dinners/:id/cancel", async (c) => {
  const me = c.get("member");
  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);
  if (!canCancelDinner(me, d.host_id)) return c.json({ error: "forbidden" }, 403);
  const closed = closedReason(d, todayIn(me.timezone, new Date()));
  if (closed) return c.json({ error: closed }, 409);

  const body = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  await c.env.DB.prepare("UPDATE dinners SET status = 'cancelled', cancel_reason = ? WHERE id = ?")
    .bind(body.data.reason ?? null, d.id)
    .run();
  return c.json({ ok: true });
});

const isRealDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

dinnerRoutes.get("/skips", async (c) => {
  const me = c.get("member");
  const { results } = await c.env.DB.prepare(
    "SELECT date, reason FROM skip_dates WHERE group_id = ? AND date >= ? ORDER BY date",
  )
    .bind(me.groupId, todayIn(me.timezone, new Date()))
    .all();
  return c.json({ skips: results });
});

// Mark a week as having no dinner. It consumes no turn; scheduling just passes over it.
dinnerRoutes.post("/skips", async (c) => {
  const me = c.get("member");
  if (!can(me, "skip_weeks")) return c.json({ error: "forbidden" }, 403);
  const body = z
    .object({ date: z.string().refine(isRealDate, "expected YYYY-MM-DD"), reason: z.string().trim().max(200).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  if (body.data.date < todayIn(me.timezone, new Date())) return c.json({ error: "date is in the past" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM dinners WHERE group_id = ? AND date = ? AND status = 'scheduled'",
  )
    .bind(me.groupId, body.data.date)
    .first();
  if (existing) return c.json({ error: "a dinner is already scheduled that day; cancel it instead" }, 409);

  await c.env.DB.prepare("INSERT OR REPLACE INTO skip_dates (group_id, date, reason) VALUES (?, ?, ?)")
    .bind(me.groupId, body.data.date, body.data.reason ?? null)
    .run();
  return c.json({ ok: true }, 201);
});

dinnerRoutes.delete("/skips/:date", async (c) => {
  const me = c.get("member");
  if (!can(me, "skip_weeks")) return c.json({ error: "forbidden" }, 403);
  await c.env.DB.prepare("DELETE FROM skip_dates WHERE group_id = ? AND date = ?")
    .bind(me.groupId, c.req.param("date"))
    .run();
  return c.json({ ok: true });
});
