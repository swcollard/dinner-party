import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { updateStatement } from "../lib/sql";

export const meRoutes = new Hono<AppBindings>();

meRoutes.get("/me", async (c) => {
  const me = c.get("member");
  const row = await c.env.DB.prepare(
    `SELECT m.email, m.phone, m.address, m.dietary, m.notify_channels, m.calendar_token,
            g.name AS group_name, g.chat_url, g.timezone, g.dinner_weekday
     FROM members m JOIN groups g ON g.id = m.group_id WHERE m.id = ?`,
  )
    .bind(me.id)
    .first<{
      email: string;
      phone: string | null;
      address: string | null;
      dietary: string | null;
      notify_channels: string;
      calendar_token: string;
      group_name: string;
      chat_url: string | null;
      timezone: string;
      dinner_weekday: number;
    }>();
  if (!row) return c.json({ error: "not found" }, 404);

  return c.json({
    id: me.id,
    name: me.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    dietary: row.dietary,
    // Dietary info is required before RSVPing yes; "none" is a valid answer.
    profileComplete: row.dietary !== null,
    notifyChannels: JSON.parse(row.notify_channels) as string[],
    role: me.role,
    permissions: me.permissions,
    calendarUrl: `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/calendar/${row.calendar_token}/dinners.ics`,
    group: {
      id: me.groupId,
      name: row.group_name,
      chatUrl: row.chat_url,
      timezone: row.timezone,
      dinnerWeekday: row.dinner_weekday,
    },
  });
});

const profile = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  // Required profile data: allergies/restrictions, or "none".
  dietary: z.string().trim().min(1).max(500).optional(),
  // Only email is delivered today; more channels plug in via src/notify.
  notifyChannels: z.array(z.enum(["email"])).min(1).optional(),
});

meRoutes.put("/me", async (c) => {
  const body = profile.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const { notifyChannels, ...rest } = body.data;
  const stmt = updateStatement(
    c.env.DB,
    "members",
    { name: "name", phone: "phone", address: "address", dietary: "dietary", notify: "notify_channels" },
    { ...rest, notify: notifyChannels && JSON.stringify(notifyChannels) },
    "id = ?",
    [c.get("member").id],
  );
  if (stmt) await stmt.run();
  return c.json({ ok: true });
});
