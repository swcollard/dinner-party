import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  forgetPerson,
  identityOnDinner,
  invitationExpiresAt,
  personalToken,
  rememberInvitation,
  rememberPerson,
  verifyInvitation,
  verifyPersonal,
} from "../auth/session";
import { MIN_SECRET_LENGTH, secretsMatch } from "../auth/tokens";
import { createGroup, findActivePerson, getSettings } from "../db/people";
import { normalizePhone } from "../domain/messages";
import { isTimeZone } from "../domain/time";
import type { AppEnv, Person } from "../types";
import { Field, Layout } from "../views/layout";
import { neutral, problem, readForm } from "./http";
import { personName } from "./names";

const setupForm = z.object({
  secret: z.string(),
  group: z.string().trim().min(1).max(80),
  name: personName,
  phone: z.string().trim(),
  timeZone: z.string().refine(isTimeZone),
});

export const access = new Hono<AppEnv>();

/** Guessing the setup secret makes someone the first organizer, so a short one keeps setup locked. */
function setupLocked(c: Context<AppEnv>) {
  if ((c.env.SETUP_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH) return null;
  return c.html(
    <Layout title="Setup is locked">
      <h1>Setup is locked</h1>
      <p>
        <code>SETUP_SECRET</code> must be at least {MIN_SECRET_LENGTH} characters. Generate one with{" "}
        <code>openssl rand -hex 32</code>, set it, and reload this page.
      </p>
    </Layout>,
    503,
  );
}

access.get("/setup", async (c) => {
  if (await getSettings(c.env.DB)) return neutral(c);
  const locked = setupLocked(c);
  if (locked) return locked;
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
  const locked = setupLocked(c);
  if (locked) return locked;
  const form = await readForm(c, setupForm);
  if (!form.success) return problem(c, "Fill in every field and use a time zone such as America/Chicago.", "/setup");
  const { secret, group, name, phone, timeZone } = form.data;
  if (!(await secretsMatch(secret, c.env.SETUP_SECRET))) {
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

/**
 * Opening someone else's link silently would let anyone with a link swap a browser onto their identity,
 * so a browser that already knows someone else asks first. Continuing is a POST, which link previews don't send.
 */
function confirmSwitch(c: Context<AppEnv>, current: Person, next: Person, stay: string, oneDinner: boolean) {
  return c.html(
    <Layout title={`Continue as ${next.name}?`} actor={c.get("actor")}>
      <h1>Continue as {next.name}?</h1>
      <p>
        This browser knows you as {current.name}.{" "}
        {oneDinner ? `This link opens one dinner as ${next.name}.` : `This is ${next.name}'s personal link.`}
      </p>
      <p>If someone sent it to you to use as yourself, stay as {current.name} and ask them for your own link.</p>
      <form method="post" action={c.req.path} class="actions">
        <button>Continue as {next.name}</button>
        <a class="button secondary" href={stay}>Stay as {current.name}</a>
      </form>
    </Layout>,
  );
}

// Link previews fetch these, so GET only sets a cookie for a browser that knows nobody else, and changes no data.
access.get("/k/:token", async (c) => {
  const token = c.req.param("token");
  const person = await verifyPersonal(c, token);
  if (!person) return neutral(c);
  const current = c.get("actor")?.person;
  if (current && current.id !== person.id) return confirmSwitch(c, current, person, "/", false);
  rememberPerson(c, token);
  return c.redirect("/", 303);
});

access.post("/k/:token", async (c) => {
  const token = c.req.param("token");
  if (!(await verifyPersonal(c, token))) return neutral(c);
  rememberPerson(c, token);
  return c.redirect("/", 303);
});

access.get("/i/:token", async (c) => {
  const token = c.req.param("token");
  const found = await verifyInvitation(c, token);
  if (!found) return neutral(c);
  const current = await identityOnDinner(c, found.dinnerPublicId);
  if (current && current.id !== found.person.id) return confirmSwitch(c, current, found.person, `/d/${found.dinnerPublicId}`, true);
  rememberInvitation(c, token, found.dinnerPublicId, invitationExpiresAt(found.dinnerStartsAt));
  return c.redirect(`/d/${found.dinnerPublicId}`, 303);
});

access.post("/i/:token", async (c) => {
  const token = c.req.param("token");
  const found = await verifyInvitation(c, token);
  if (!found) return neutral(c);
  rememberInvitation(c, token, found.dinnerPublicId, invitationExpiresAt(found.dinnerStartsAt));
  return c.redirect(`/d/${found.dinnerPublicId}`, 303);
});

access.post("/forget", (c) => {
  forgetPerson(c);
  return neutral(c);
});
