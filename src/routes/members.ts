import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { can, PERMISSIONS } from "../lib/permissions";
import { memberLink, provisionMember, reissueLink } from "../lib/provision";
import { isUniqueViolation, updateStatement } from "../lib/sql";
import { todayIn } from "../lib/time";
import { canNotify, sendInvite, sendNewLink } from "../notify/reminders";

export const memberRoutes = new Hono<AppBindings>();

interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "admin" | "member";
  permissions: string;
  rotation_position: number;
  active: number;
}

memberRoutes.get("/members", async (c) => {
  const me = c.get("member");
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, phone, role, permissions, rotation_position, active
     FROM members WHERE group_id = ? ORDER BY rotation_position, id`,
  )
    .bind(me.groupId)
    .all<MemberRow>();
  const privileged = can(me, "manage_members");
  return c.json({
    members: results.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      position: m.rotation_position,
      active: !!m.active,
      // Contact details and grants are only for people who manage members.
      ...(privileged ? { email: m.email, phone: m.phone, permissions: JSON.parse(m.permissions) as string[] } : {}),
    })),
  });
});

const newMember = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  phone: z.string().trim().max(40).optional(),
});

// Add a member at the end of the rotation and return their personal link to share.
memberRoutes.post("/members", async (c) => {
  const me = c.get("member");
  if (!can(me, "manage_members")) return c.json({ error: "forbidden" }, 403);
  const body = newMember.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  try {
    const m = await provisionMember(c.env.DB, { groupId: me.groupId, ...body.data, role: "member" });
    const link = memberLink(c.env.PUBLIC_BASE_URL, m.token);
    c.executionCtx.waitUntil(
      (async () => {
        const g = await c.env.DB.prepare("SELECT name FROM groups WHERE id = ?").bind(me.groupId).first<{ name: string }>();
        await sendInvite(
          c.env,
          { key: `member:${m.id}`, name: body.data.name, email: body.data.email, phone: body.data.phone, channels: ["email"] },
          g?.name ?? "the group",
          link,
        );
      })(),
    );
    return c.json({ id: m.id, link }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "a member with that email already exists" }, 409);
    throw e;
  }
});

// Set the whole rotation order in one go. Must list every member of the group exactly once.
memberRoutes.put("/members/order", async (c) => {
  const me = c.get("member");
  if (!can(me, "manage_members")) return c.json({ error: "forbidden" }, 403);
  const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  const { results } = await c.env.DB.prepare("SELECT id FROM members WHERE group_id = ?")
    .bind(me.groupId)
    .all<{ id: string }>();
  const existing = new Set(results.map((r) => r.id));
  const given = new Set(body.data.ids);
  if (given.size !== body.data.ids.length || given.size !== existing.size || ![...given].every((id) => existing.has(id))) {
    return c.json({ error: "ids must list every member of the group exactly once" }, 400);
  }
  await c.env.DB.batch(
    body.data.ids.map((id, i) =>
      c.env.DB.prepare("UPDATE members SET rotation_position = ? WHERE id = ? AND group_id = ?").bind(i, id, me.groupId),
    ),
  );
  return c.json({ ok: true });
});

const memberPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
  // Role and grants change what people can do, so only admins may set them.
  role: z.enum(["admin", "member"]).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

memberRoutes.put("/members/:id", async (c) => {
  const me = c.get("member");
  if (!can(me, "manage_members")) return c.json({ error: "forbidden" }, 403);
  const body = memberPatch.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const patch = body.data;
  if ((patch.role !== undefined || patch.permissions !== undefined) && me.role !== "admin") {
    return c.json({ error: "only admins can change roles and permissions" }, 403);
  }

  const target = await c.env.DB.prepare("SELECT role FROM members WHERE id = ? AND group_id = ?")
    .bind(c.req.param("id"), me.groupId)
    .first<{ role: "admin" | "member" }>();
  if (!target) return c.json({ error: "not found" }, 404);
  if (target.role === "admin" && me.role !== "admin") return c.json({ error: "only admins can modify admins" }, 403);

  // Never leave a group without an active admin.
  if (target.role === "admin" && (patch.role === "member" || patch.active === false)) {
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND role = 'admin' AND active = 1",
    )
      .bind(me.groupId)
      .first<{ n: number }>();
    if ((row?.n ?? 0) <= 1) return c.json({ error: "a group needs at least one active admin" }, 409);
  }

  // Deactivating someone who is hosting an upcoming dinner would leave it with a host who can't
  // log in or be notified. Make the organizer hand it over (or cancel it) first.
  if (patch.active === false) {
    const hosting = await c.env.DB.prepare(
      `SELECT id, date FROM dinners
       WHERE group_id = ? AND host_id = ? AND status = 'scheduled' AND date >= ? ORDER BY date`,
    )
      .bind(me.groupId, c.req.param("id"), todayIn(me.timezone, new Date()))
      .all<{ id: string; date: string }>();
    if (hosting.results.length > 0) {
      return c.json(
        {
          error: "hosts_upcoming_dinners",
          message: "Change the host (or cancel these dinners) before deactivating this member.",
          dinners: hosting.results,
        },
        409,
      );
    }
  }

  const stmt = updateStatement(
    c.env.DB,
    "members",
    { name: "name", active: "active", role: "role", permissions: "permissions" },
    {
      ...patch,
      active: patch.active === undefined ? undefined : Number(patch.active),
      permissions: patch.permissions && JSON.stringify(patch.permissions),
    },
    "id = ? AND group_id = ?",
    [c.req.param("id"), me.groupId],
  );
  if (stmt) await stmt.run();
  return c.json({ ok: true });
});

// Issue a fresh personal link (revoking the old ones): for a lost phone or a leaked link.
// Members can reissue their own and admins anyone's; both get the link back to share.
// Delegates (manage_members without admin) must NOT receive someone else's link: it
// would let them act as that person, with permissions and private data they were not
// granted. For them the link is emailed straight to the member instead.
memberRoutes.post("/members/:id/link", async (c) => {
  const me = c.get("member");
  const id = c.req.param("id");
  const isSelf = id === me.id;
  if (!isSelf && !can(me, "manage_members")) return c.json({ error: "forbidden" }, 403);

  const target = await c.env.DB.prepare(
    "SELECT name, email, phone, role, notify_channels FROM members WHERE id = ? AND group_id = ? AND active = 1",
  )
    .bind(id, me.groupId)
    .first<{ name: string; email: string; phone: string | null; role: "admin" | "member"; notify_channels: string }>();
  if (!target) return c.json({ error: "not found" }, 404);

  if (isSelf || me.role === "admin") {
    const token = await reissueLink(c.env.DB, me.groupId, id);
    return c.json({ link: memberLink(c.env.PUBLIC_BASE_URL, token) });
  }

  if (target.role === "admin") return c.json({ error: "forbidden" }, 403);
  const recipient = {
    key: `member:${id}`,
    name: target.name,
    email: target.email,
    phone: target.phone,
    channels: JSON.parse(target.notify_channels) as string[],
  };
  if (!canNotify(c.env, recipient)) {
    return c.json({ error: "email_not_configured", message: "Ask an admin to reissue this link." }, 409);
  }
  const group = await c.env.DB.prepare("SELECT name FROM groups WHERE id = ?").bind(me.groupId).first<{ name: string }>();
  try {
    await reissueLink(c.env.DB, me.groupId, id, (token) =>
      sendNewLink(c.env, recipient, group?.name ?? "the group", memberLink(c.env.PUBLIC_BASE_URL, token)),
    );
  } catch (e) {
    console.error("link delivery failed", e);
    return c.json({ error: "could not send the link; the old one still works" }, 502);
  }
  return c.json({ sent: true });
});
