import { createMiddleware } from "hono/factory";
import type { AppBindings } from "./env";

/**
 * STUB. Real implementation: magic-link login.
 *   POST /auth/request  -> email a one-time link (hash stored in login_tokens)
 *   GET  /auth/verify   -> consume token, set signed session cookie
 * This middleware will then verify the cookie (signed with SESSION_SECRET)
 * and load the member row. Until then every request is rejected.
 */
export const requireMember = createMiddleware<AppBindings>(async (c, next) => {
  // TODO: verify session cookie, c.set("member", { id, groupId, role })
  return c.json({ error: "auth not implemented" }, 501);
});
