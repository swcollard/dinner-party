import { Hono } from "hono";
import { z } from "zod";
import { requireMember } from "./auth";
import type { AppBindings } from "./env";
import { buildIcs } from "./lib/ics";
import { planNextDinner } from "./lib/rotation";
import { todayIn } from "./lib/time";
import { runReminders } from "./notify";

const app = new Hono<AppBindings>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Everything below requires a logged-in member.
app.use("/api/*", async (c, next) =>
  c.req.path === "/api/health" ? next() : requireMember(c, next),
);

app.get("/api/dinners", async (c) => {
  const { groupId } = c.get("member");
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, m.name AS host_name FROM dinners d
     JOIN members m ON m.id = d.host_id
     WHERE d.group_id = ? AND d.date >= date('now') ORDER BY d.date`,
  )
    .bind(groupId)
    .all();
  return c.json({ dinners: results });
});

// Admin: schedule the next dinner using the fixed rotation order.
app.post("/api/dinners/schedule-next", async (c) => {
  const { groupId, role } = c.get("member");
  if (role !== "admin") return c.json({ error: "forbidden" }, 403);

  const [group, members, dinners, skips] = await Promise.all([
    c.env.DB.prepare(
      "SELECT timezone, dinner_weekday, default_start_time FROM groups WHERE id = ?",
    )
      .bind(groupId)
      .first<{ timezone: string; dinner_weekday: number; default_start_time: string }>(),
    c.env.DB.prepare("SELECT id, rotation_position, active FROM members WHERE group_id = ?")
      .bind(groupId)
      .all<{ id: string; rotation_position: number; active: number }>(),
    c.env.DB.prepare("SELECT date, status, rotation_host_id FROM dinners WHERE group_id = ?")
      .bind(groupId)
      .all<{ date: string; status: "scheduled" | "cancelled" | "done"; rotation_host_id: string | null }>(),
    c.env.DB.prepare("SELECT date FROM skip_dates WHERE group_id = ?")
      .bind(groupId)
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
    .bind(id, groupId, plan.rotationHostId, plan.rotationHostId, plan.date, group.default_start_time)
    .run();
  return c.json({ id, hostId: plan.rotationHostId, date: plan.date }, 201);
});

const rsvpBody = z.object({
  response: z.enum(["yes", "no", "maybe"]),
  guests: z.number().int().min(0).max(10).default(0),
});

app.put("/api/dinners/:id/rsvp", async (c) => {
  const { id: memberId } = c.get("member");
  const body = rsvpBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  await c.env.DB.prepare(
    `INSERT INTO rsvps (dinner_id, member_id, response, guests) VALUES (?, ?, ?, ?)
     ON CONFLICT (dinner_id, member_id)
     DO UPDATE SET response = excluded.response, guests = excluded.guests, updated_at = datetime('now')`,
  )
    .bind(c.req.param("id"), memberId, body.data.response, body.data.guests)
    .run();
  return c.json({ ok: true });
});

// TODO: swap/cancel host, edit menu, members CRUD, dietary summary per dinner.

// Calendar subscription. TODO: authenticate with a per-member secret token in
// the URL (calendar apps can't send cookies), and include the host address.
app.get("/calendar/:token/dinners.ics", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.date, d.start_time, d.menu, m.name AS host_name
     FROM dinners d JOIN members m ON m.id = d.host_id
     WHERE d.status = 'scheduled' ORDER BY d.date`,
  ).all<{ id: string; date: string; start_time: string; menu: string | null; host_name: string }>();
  const ics = buildIcs(
    "Dinner Party",
    results.map((d) => ({
      uid: d.id,
      date: d.date,
      startTime: d.start_time,
      summary: `Dinner at ${d.host_name}'s`,
      description: d.menu ?? undefined,
    })),
  );
  return c.body(ics, 200, { "content-type": "text/calendar; charset=utf-8" });
});

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: AppBindings["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(runReminders(env, new Date()));
  },
} satisfies ExportedHandler<AppBindings["Bindings"]>;
