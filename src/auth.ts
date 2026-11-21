import { createMiddleware } from "hono/factory";
import type { AppBindings } from "./env";
import { effectivePermissions } from "./lib/permissions";
import { hashToken } from "./lib/tokens";

/**
 * Personal-link auth (v1, no accounts). A member's link carries an unguessable
 * token; the app sends it as `Authorization: Bearer <token>`. We look up its
 * SHA-256 hash, so a database leak does not expose usable links. Revoking a
 * token or deactivating the member cuts access immediately.
 */
export const requireMember = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const row = await c.env.DB.prepare(
    `SELECT m.id, m.group_id, m.name, m.role, m.permissions,
            g.member_permissions, g.timezone
     FROM access_tokens t
     JOIN members m ON m.id = t.member_id
     JOIN groups g ON g.id = m.group_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND m.active = 1`,
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      group_id: string;
      name: string;
      role: "admin" | "member";
      permissions: string;
      member_permissions: string;
      timezone: string;
    }>();
  if (!row) return c.json({ error: "unauthorized" }, 401);

  c.set("member", {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    role: row.role,
    permissions: effectivePermissions(row.member_permissions, row.permissions),
    timezone: row.timezone,
  });
  await next();
});
