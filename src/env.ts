import type { Permission } from "./lib/permissions";

export interface Env {
  DB: D1Database;
  /** Private R2 bucket for weekly database exports. */
  BACKUPS: R2Bucket;
  /** Public origin of the app, used to build personal links (no trailing slash). */
  PUBLIC_BASE_URL: string;
  /** Shared secret protecting POST /admin/groups (platform operator only). */
  SETUP_SECRET: string;
  /** Resend API key. Without it no notifications are sent (reminders become no-ops). */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Override the email API endpoint (used to point tests at a local mock). */
  EMAIL_API_URL?: string;
  /**
   * Max reminder sends per cron run (default 40). Each send is one outbound fetch plus a few D1
   * queries; keep this under your Workers plan's per-invocation subrequest limit. Anything over
   * budget is picked up by the next run (every 15 minutes).
   */
  REMINDER_SEND_BUDGET?: string;
}

export interface AuthedMember {
  id: string;
  groupId: string;
  name: string;
  role: "admin" | "member";
  /** Effective grants: group default plus member-specific. */
  permissions: Permission[];
  /** The group's IANA timezone. */
  timezone: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { member: AuthedMember };
};
