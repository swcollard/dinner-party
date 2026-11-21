import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { canEditDinner } from "../lib/permissions";
import { findDinner, type DinnerRow } from "./dinners";

export const attendanceRoutes = new Hono<AppBindings>();

const MAX_GUESTS_PER_MEMBER = 10;

type Ctx = Context<AppBindings>;

/** The dinner in the caller's group if it is still on; otherwise a ready-made error response. */
async function openDinner(c: Ctx): Promise<{ dinner: DinnerRow } | { res: Response }> {
  const d = await findDinner(c.env.DB, c.req.param("id") ?? "", c.get("member").groupId);
  if (!d) return { res: c.json({ error: "not found" }, 404) };
  if (d.status !== "scheduled") return { res: c.json({ error: `dinner is ${d.status}` }, 409) };
  return { dinner: d };
}

const rsvpBody = z.object({ response: z.enum(["yes", "no", "maybe"]) });

attendanceRoutes.put("/dinners/:id/rsvp", async (c) => {
  const me = c.get("member");
  const body = rsvpBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const found = await openDinner(c);
  if ("res" in found) return found.res;

  // Hosts need to know about allergies, so dietary info is required before saying yes ("none" counts).
  if (body.data.response === "yes") {
    const profile = await c.env.DB.prepare("SELECT dietary FROM members WHERE id = ?")
      .bind(me.id)
      .first<{ dietary: string | null }>();
    if (profile?.dietary == null) {
      return c.json({ error: "dietary_required", message: "Add your dietary needs (or \"none\") to your profile first." }, 409);
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO rsvps (dinner_id, member_id, response) VALUES (?, ?, ?)
     ON CONFLICT (dinner_id, member_id)
     DO UPDATE SET response = excluded.response, updated_at = datetime('now')`,
  )
    .bind(found.dinner.id, me.id, body.data.response)
    .run();
  return c.json({ ok: true });
});

const newGuest = z.object({
  name: z.string().trim().min(1).max(100),
  // Optional contact details so the guest can get reminders.
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
  dietary: z.string().trim().max(500).optional(),
  response: z.enum(["yes", "no", "maybe"]).default("yes"),
});

// A member brings a plus-one (or any non-member guest).
attendanceRoutes.post("/dinners/:id/guests", async (c) => {
  const me = c.get("member");
  const body = newGuest.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const found = await openDinner(c);
  if ("res" in found) return found.res;

  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE dinner_id = ? AND invited_by = ?")
    .bind(found.dinner.id, me.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_GUESTS_PER_MEMBER) return c.json({ error: "too many guests" }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO guests (id, group_id, dinner_id, invited_by, name, email, phone, dietary, response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, me.groupId, found.dinner.id, me.id, body.data.name, body.data.email ?? null, body.data.phone ?? null, body.data.dietary ?? null, body.data.response)
    .run();
  return c.json({ id }, 201);
});

/** A guest on an open dinner that the caller may change, or a ready-made error response. */
async function editableGuest(c: Ctx): Promise<{ guestId: string } | { res: Response }> {
  const found = await openDinner(c);
  if ("res" in found) return found;
  const guest = await c.env.DB.prepare("SELECT id, invited_by FROM guests WHERE id = ? AND dinner_id = ?")
    .bind(c.req.param("guestId") ?? "", found.dinner.id)
    .first<{ id: string; invited_by: string }>();
  if (!guest) return { res: c.json({ error: "not found" }, 404) };
  // The member who brought them, the host, or anyone allowed to edit any dinner.
  const me = c.get("member");
  if (guest.invited_by !== me.id && !canEditDinner(me, found.dinner.host_id)) {
    return { res: c.json({ error: "forbidden" }, 403) };
  }
  return { guestId: guest.id };
}

attendanceRoutes.put("/dinners/:id/guests/:guestId", async (c) => {
  const body = z.object({ response: z.enum(["yes", "no", "maybe"]) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const found = await editableGuest(c);
  if ("res" in found) return found.res;
  await c.env.DB.prepare("UPDATE guests SET response = ? WHERE id = ?").bind(body.data.response, found.guestId).run();
  return c.json({ ok: true });
});

attendanceRoutes.delete("/dinners/:id/guests/:guestId", async (c) => {
  const found = await editableGuest(c);
  if ("res" in found) return found.res;
  await c.env.DB.prepare("DELETE FROM guests WHERE id = ?").bind(found.guestId).run();
  return c.json({ ok: true });
});
