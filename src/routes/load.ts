import type { Context } from "hono";
import { type Action, can } from "../auth/permissions";
import { findDinner } from "../db/dinners";
import { getSettings } from "../db/people";
import { isPast } from "../domain/time";
import type { AppEnv } from "../types";

/** Loads a dinner only if the current person may do `action` on it. */
export async function loadDinner(c: Context<AppEnv>, publicId: string, action: Action) {
  const actor = c.get("actor");
  const [dinner, settings] = await Promise.all([findDinner(c.env.DB, publicId), getSettings(c.env.DB)]);
  if (!actor || !dinner || !settings) return null;
  const context = { ...dinner, past: isPast(dinner.starts_at, settings.time_zone) };
  if (!can(actor, action, context)) return null;
  return { actor, dinner: context, settings, path: `/d/${dinner.public_id}` };
}
