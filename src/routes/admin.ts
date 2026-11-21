import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { isValidTimezone } from "../lib/time";
import { isUniqueViolation } from "../lib/sql";
import { memberLink, provisionMember } from "../lib/provision";

export const adminRoutes = new Hono<AppBindings>();

async function secretMatches(provided: string | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const createGroup = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().refine(isValidTimezone, "unknown timezone").default("America/Chicago"),
  admin: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.email(),
    phone: z.string().trim().max(40).optional(),
  }),
});

/**
 * Bootstrap a group and its first admin. Guarded by SETUP_SECRET because there
 * are no accounts: whoever holds the secret decides which groups exist.
 */
adminRoutes.post("/groups", async (c) => {
  if (!(await secretMatches(c.req.header("x-setup-secret"), c.env.SETUP_SECRET))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = createGroup.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);

  const groupId = crypto.randomUUID();
  try {
    const admin = await provisionMember(
      c.env.DB,
      { groupId, ...body.data.admin, role: "admin" },
      [
        c.env.DB.prepare("INSERT INTO groups (id, name, timezone) VALUES (?, ?, ?)").bind(
          groupId,
          body.data.name,
          body.data.timezone,
        ),
      ],
    );
    return c.json({ groupId, adminId: admin.id, adminLink: memberLink(c.env.PUBLIC_BASE_URL, admin.token) }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "conflict" }, 409);
    throw e;
  }
});
