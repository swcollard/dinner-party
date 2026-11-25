import type { Actor, Dinner } from "../types";

export type Action =
  | "dinner.view"
  | "dinner.create"
  | "dinner.chooseHost"
  | "dinner.edit"
  | "poll.confirm"
  | "poll.vote"
  | "rsvp.own"
  | "menu.edit"
  | "dish.own"
  | "dish.assign"
  | "dish.any"
  | "announce"
  | "profile.own"
  | "members.manage"
  | "seasons.manage";

const ONE_DINNER_ACTIONS: Action[] = ["dinner.view", "poll.vote", "rsvp.own", "dish.own", "profile.own"];
const MEMBER_ACTIONS: Action[] = [...ONE_DINNER_ACTIONS, "dinner.create"];
const HOST_ACTIONS: Action[] = [
  ...MEMBER_ACTIONS,
  "dinner.edit",
  "poll.confirm",
  "menu.edit",
  "dish.assign",
  "dish.any",
  "announce",
];
const NOT_ABOUT_A_DINNER: Action[] = [
  "dinner.create",
  "dinner.chooseHost",
  "profile.own",
  "members.manage",
  "seasons.manage",
];

/**
 * The PRD permissions table, plus: any member may create a dinner and becomes its host,
 * and only organizers choose someone else.
 */
export function can(
  actor: Actor | null,
  action: Action,
  dinner?: Pick<Dinner, "id" | "host_id"> & { past: boolean },
): boolean {
  if (!actor) return false;
  if (!dinner && !NOT_ABOUT_A_DINNER.includes(action)) return false;

  // Hosts can see one-dinner links, so these never carry the person's wider powers.
  if (actor.scope === "dinner") {
    if (dinner && dinner.id !== actor.dinnerId) return false;
    if (dinner?.past && action !== "dinner.view") return false;
    // Profiles apply to every dinner. A guest's only ever covers this one.
    if (action === "profile.own") return actor.person.kind === "guest";
    return ONE_DINNER_ACTIONS.includes(action);
  }
  if (actor.person.kind !== "member") return false;
  if (actor.person.is_organizer) return true;
  if (dinner?.past) return action === "dinner.view";
  return (dinner?.host_id === actor.person.id ? HOST_ACTIONS : MEMBER_ACTIONS).includes(action);
}
