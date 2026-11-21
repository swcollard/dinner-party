import type { Permission } from "./lib/permissions";

export interface Env {
  DB: D1Database;
  /** Public origin of the app, used to build personal links (no trailing slash). */
  PUBLIC_BASE_URL: string;
  /** Shared secret protecting POST /admin/groups (platform operator only). */
  SETUP_SECRET: string;
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
