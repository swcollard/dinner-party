import { Hono } from "hono";
import { z } from "zod";
import {
  forgetPerson,
  personalToken,
  rememberInvitation,
  rememberPerson,
  verifyInvitation,
  verifyPersonal,
} from "../auth/session";
import { secretsMatch } from "../auth/tokens";
import { createGroup, findActivePerson, getSettings } from "../db/people";
import { normalizePhone } from "../domain/messages";
import { isTimeZone } from "../domain/time";
import type { AppEnv } from "../types";
import { Field, Layout } from "../views/layout";
import { neutral, problem, readForm } from "./http";

const setupForm = z.object({
  secret: z.string(),
  group: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim(),
  timeZone: z.string().refine(isTimeZone),
});

export const access = new Hono<AppEnv>();

access.get("/setup", async (c) => {
  if (await getSettings(c.env.DB)) return neutral(c);
  return c.html(
    <Layout title="Set up">
      <h1>Set up your group</h1>
      <form method="post" action="/setup" class="stack">
        <Field label="Setup secret" name="secret" type="password" required />
        <Field label="Group name" name="group" required />
        <Field label="Your name" name="name" required autocomplete="name" />
        <Field label="Your phone (optional)" name="phone" type="tel" autocomplete="tel" />
        <Field label="Time zone" name="timeZone" value="America/Chicago" required />
        <button>Create group</button>
      </form>
    </Layout>,
  );
});

access.post("/setup", async (c) => {
  if (await getSettings(c.env.DB)) return neutral(c);
  const form = await readForm(c, setupForm);
  if (!form.success) return problem(c, "Fill in every field and use a time zone such as America/Chicago.", "/setup");
  const { secret, group, name, phone, timeZone } = form.data;
  if (!c.env.SETUP_SECRET || !(await secretsMatch(secret, c.env.SETUP_SECRET))) {
    return problem(c, "That setup secret isn't right.", "/setup", 403);
  }
  const normalized = phone ? normalizePhone(phone) : null;
  if (phone && !normalized) return problem(c, "That phone number doesn't look right.", "/setup");

  const publicId = await createGroup(c.env.DB, { name: group, timeZone }, { name, phone: normalized });
  const person = publicId && (await findActivePerson(c.env.DB, publicId));
  if (!person) return neutral(c);
  rememberPerson(c, await personalToken(c.env.LINK_SECRET, person));
  return c.redirect("/members", 303);
});

// Link previews fetch these, so they set a cookie and change no data.
access.get("/k/:token", async (c) => {
  const token = c.req.param("token");
  if (!(await verifyPersonal(c, token))) return neutral(c);
  rememberPerson(c, token);
  return c.redirect("/", 303);
});

access.get("/i/:token", async (c) => {
  const token = c.req.param("token");
  const found = await verifyInvitation(c, token);
  if (!found) return neutral(c);
  rememberInvitation(c, token, found.dinnerPublicId);
  return c.redirect(`/d/${found.dinnerPublicId}`, 303);
});

access.post("/forget", (c) => {
  forgetPerson(c);
  return neutral(c);
});
