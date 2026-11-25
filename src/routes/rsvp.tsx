import { type Context, Hono } from "hono";
import { z } from "zod";
import { addPlusOne, findOwnInvitation, removePlusOne, setRsvp, updatePlusOne } from "../db/rsvps";
import type { AppEnv } from "../types";
import { neutral, problem, readForm } from "./http";
import { loadDinner } from "./load";
import { needFields, toNeeds } from "./needs";

const rsvpForm = z.object({ rsvp: z.enum(["yes", "maybe", "no"]) });
const plusOneForm = z.object({ name: z.string().trim().min(1).max(80), ...needFields });

export const rsvp = new Hono<AppEnv>();

/** The person's own invitation, or the response explaining why they can't reply. */
async function loadOwn(c: Context<AppEnv>, id: string) {
  const loaded = await loadDinner(c, id, "rsvp.own");
  if (!loaded) return neutral(c);
  const { dinner, actor, path } = loaded;
  if (dinner.status !== "confirmed") return problem(c, "This dinner isn't taking replies.", path, 409);
  if (dinner.rsvp_closed) return problem(c, "The host has closed replies. Let them know directly.", path, 409);
  const invitation = await findOwnInvitation(c.env.DB, dinner.id, actor.person.id);
  return invitation ? { ...loaded, invitation } : problem(c, "You're not on this guest list.", path, 403);
}

rsvp.post("/d/:id/rsvp", async (c) => {
  const own = await loadOwn(c, c.req.param("id"));
  if (own instanceof Response) return own;
  const form = await readForm(c, rsvpForm);
  if (!form.success) return problem(c, "Choose yes, maybe or no.", own.path);
  if (form.data.rsvp !== "yes" && own.dinner.host_id === own.actor.person.id) {
    return problem(c, "You're hosting, so you're counted as coming.", own.path, 409);
  }
  await setRsvp(c.env.DB, own.invitation, form.data.rsvp);
  return c.redirect(own.path, 303);
});

rsvp.post("/d/:id/plus-ones", async (c) => {
  const own = await loadOwn(c, c.req.param("id"));
  if (own instanceof Response) return own;
  if (own.actor.person.kind !== "member") return problem(c, "Ask the host before bringing someone.", own.path, 403);
  const form = await readForm(c, plusOneForm);
  if (!form.success) return problem(c, "Enter their name.", own.path);
  if (!(await addPlusOne(c.env.DB, own.invitation.id, form.data.name, toNeeds(form.data)))) {
    return problem(c, "Say yes first. You can bring up to 10 people.", own.path, 409);
  }
  return c.redirect(own.path, 303);
});

rsvp.post("/d/:id/plus-ones/:attendee/edit", async (c) => {
  const own = await loadOwn(c, c.req.param("id"));
  if (own instanceof Response) return own;
  const form = await readForm(c, plusOneForm);
  if (!form.success) return problem(c, "Enter their name.", own.path);
  const id = Number(c.req.param("attendee"));
  await updatePlusOne(c.env.DB, own.invitation.id, id, form.data.name, toNeeds(form.data));
  return c.redirect(own.path, 303);
});

rsvp.post("/d/:id/plus-ones/:attendee/remove", async (c) => {
  const own = await loadOwn(c, c.req.param("id"));
  if (own instanceof Response) return own;
  await removePlusOne(c.env.DB, own.invitation.id, Number(c.req.param("attendee")));
  return c.redirect(own.path, 303);
});
