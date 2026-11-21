import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { can, PERMISSIONS } from "../lib/permissions";
import { updateStatement } from "../lib/sql";
import { isValidTimezone } from "../lib/time";

export const groupRoutes = new Hono<AppBindings>();

const settings = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Link to the group chat (e.g. a WhatsApp invite link).
  chatUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
  timezone: z.string().refine(isValidTimezone, "unknown timezone").optional(),
  dinnerWeekday: z.number().int().min(0).max(6).optional(), // 0 = Sunday
  defaultStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  rsvpDeadlineDays: z.number().int().min(0).max(14).optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  // What every non-admin member may do, beyond the basics.
  memberPermissions: z.array(z.enum(PERMISSIONS)).optional(),
});

groupRoutes.put("/group", async (c) => {
  const me = c.get("member");
  if (!can(me, "manage_settings")) return c.json({ error: "forbidden" }, 403);
  const body = settings.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  const stmt = updateStatement(
    c.env.DB,
    "groups",
    {
      name: "name",
      chatUrl: "chat_url",
      timezone: "timezone",
      dinnerWeekday: "dinner_weekday",
      defaultStartTime: "default_start_time",
      rsvpDeadlineDays: "rsvp_deadline_days",
      reminderHour: "reminder_hour",
      memberPermissions: "member_permissions",
    },
    { ...body.data, memberPermissions: body.data.memberPermissions && JSON.stringify(body.data.memberPermissions) },
    "id = ?",
    [me.groupId],
  );
  if (stmt) await stmt.run();
  return c.json({ ok: true });
});
