/**
 * Permissions. Admins can do everything. Other members get the group's default
 * grants plus any extra grants on their own row. Things every member can always
 * do (RSVP, edit their own profile, add guests, sign up a dish) and things a
 * host can do for their own dinner are not permissions; they are checked by
 * identity in the routes.
 */
export const PERMISSIONS = [
  "schedule_dinners",
  "skip_weeks",
  "override_host",
  "cancel_dinners",
  "edit_any_dinner",
  "manage_members",
  "manage_settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface Actor {
  id: string;
  role: "admin" | "member";
  /** Effective grants: group default plus member-specific. */
  permissions: Permission[];
}

export const isPermission = (s: unknown): s is Permission =>
  typeof s === "string" && (PERMISSIONS as readonly string[]).includes(s);

/** Parse a stored JSON array, dropping anything that is not a known permission. */
export function parsePermissions(json: string | null | undefined): Permission[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? [...new Set(v.filter(isPermission))] : [];
  } catch {
    return [];
  }
}

export function effectivePermissions(groupDefault: string, own: string): Permission[] {
  return [...new Set([...parsePermissions(groupDefault), ...parsePermissions(own)])];
}

export const can = (a: Actor, p: Permission): boolean =>
  a.role === "admin" || a.permissions.includes(p);

/** A dinner's host, or anyone allowed to edit any dinner. */
export const canEditDinner = (a: Actor, hostId: string): boolean =>
  a.id === hostId || can(a, "edit_any_dinner");

/** A dinner's host, or anyone allowed to cancel dinners. */
export const canCancelDinner = (a: Actor, hostId: string): boolean =>
  a.id === hostId || can(a, "cancel_dinners");
