import { Hono } from "hono";
import { z } from "zod";
import { can } from "../auth/permissions";
import { listNeeds, saveNeeds, saveProfile } from "../db/diet";
import { normalizePhone } from "../domain/messages";
import type { AppEnv } from "../types";
import { NeedFields } from "../views/diet";
import { Field, Layout } from "../views/layout";
import { neutral, problem, readForm } from "./http";
import { loadDinner } from "./load";
import { needFields, needsForm, toNeeds } from "./needs";

const profileForm = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim(),
  textsOptOut: z.literal("on").optional(),
  ...needFields,
});

export const profile = new Hono<AppEnv>();

profile.get("/profile", async (c) => {
  const actor = c.get("actor");
  if (!actor || actor.scope !== "full" || !can(actor, "profile.own")) return neutral(c);
  const { person } = actor;
  return c.html(
    <Layout title="Your profile" actor={actor}>
      <h1>Your profile</h1>
      <p>Dietary needs are shared with the group for every dinner you're coming to.</p>
      <form method="post" action="/profile" class="stack">
        <Field label="Name" name="name" value={person.name} required autocomplete="name" />
        <Field label="Phone" name="phone" type="tel" value={person.phone ?? ""} autocomplete="tel" />
        <NeedFields needs={await listNeeds(c.env.DB, person.id)} />
        <label class="check">
          <input type="checkbox" name="textsOptOut" checked={!!person.texts_opt_out} /> Leave me out of texts
        </label>
        <button>Save</button>
      </form>
    </Layout>,
  );
});

profile.post("/profile", async (c) => {
  const actor = c.get("actor");
  if (!actor || actor.scope !== "full" || !can(actor, "profile.own")) return neutral(c);
  const form = await readForm(c, profileForm);
  if (!form.success) return problem(c, "Enter your name.", "/profile");
  const phone = form.data.phone ? normalizePhone(form.data.phone) : null;
  if (form.data.phone && !phone) return problem(c, "That phone number doesn't look right.", "/profile");
  await saveProfile(
    c.env.DB,
    actor.person.id,
    { name: form.data.name, phone, textsOptOut: !!form.data.textsOptOut },
    toNeeds(form.data),
  );
  return c.redirect("/", 303);
});

// How guests set their needs, having no profile. Members can use it too, but not through a one-dinner
// link: hosts can see those, and needs apply to every dinner.
profile.get("/d/:id/diet", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "profile.own");
  if (!loaded) return neutral(c);
  const { actor, dinner, path } = loaded;
  return c.html(
    <Layout title="Your dietary needs" actor={actor} forgetPath={`${path}/forget`}>
      <h1>Your dietary needs</h1>
      <p><a href={path}>Back to {dinner.title}</a></p>
      <form method="post" action={`${path}/diet`} class="stack">
        <NeedFields needs={await listNeeds(c.env.DB, actor.person.id)} />
        <button>Save</button>
      </form>
    </Layout>,
  );
});

profile.post("/d/:id/diet", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "profile.own");
  if (!loaded) return neutral(c);
  const form = await readForm(c, needsForm);
  if (!form.success) return problem(c, "Try that again.", `${loaded.path}/diet`);
  await saveNeeds(c.env.DB, loaded.actor.person.id, toNeeds(form.data));
  return c.redirect(loaded.path, 303);
});
