import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { closedReason } from "../lib/dinner-state";
import { canEditDinner } from "../lib/permissions";
import { todayIn } from "../lib/time";
import { findDinner } from "./dinners";

export const potluckRoutes = new Hono<AppBindings>();

const COURSES = ["starter", "main", "side", "dessert", "drink", "other"] as const;

const newDish = z.object({
  course: z.enum(COURSES).default("other"),
  description: z.string().trim().min(1).max(200),
  // e.g. "contains nuts, gluten-free" so the host and other guests can plan around it.
  dietaryNotes: z.string().trim().max(300).optional(),
});

// Sign up to bring a dish. Only available when the dinner's menu style includes a potluck.
potluckRoutes.post("/dinners/:id/dishes", async (c) => {
  const me = c.get("member");
  const body = newDish.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);
  const closed = closedReason(d, todayIn(me.timezone, new Date()));
  if (closed) return c.json({ error: closed }, 409);
  if (d.menu_mode === "host") return c.json({ error: "this dinner's menu is chosen by the host" }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO dishes (id, group_id, dinner_id, member_id, course, description, dietary_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, me.groupId, d.id, me.id, body.data.course, body.data.description, body.data.dietaryNotes ?? null)
    .run();
  return c.json({ id }, 201);
});

// Remove a dish: the person bringing it, the host, or anyone allowed to edit any dinner.
potluckRoutes.delete("/dinners/:id/dishes/:dishId", async (c) => {
  const me = c.get("member");
  const d = await findDinner(c.env.DB, c.req.param("id"), me.groupId);
  if (!d) return c.json({ error: "not found" }, 404);
  const closed = closedReason(d, todayIn(me.timezone, new Date()));
  if (closed) return c.json({ error: closed }, 409);
  const dish = await c.env.DB.prepare("SELECT id, member_id FROM dishes WHERE id = ? AND dinner_id = ?")
    .bind(c.req.param("dishId"), d.id)
    .first<{ id: string; member_id: string }>();
  if (!dish) return c.json({ error: "not found" }, 404);
  if (dish.member_id !== me.id && !canEditDinner(me, d.host_id)) return c.json({ error: "forbidden" }, 403);
  await c.env.DB.prepare("DELETE FROM dishes WHERE id = ?").bind(dish.id).run();
  return c.json({ ok: true });
});
