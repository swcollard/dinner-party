import { type Context, Hono } from "hono";
import { z } from "zod";
import { can } from "../auth/permissions";
import { personalToken, rememberPerson } from "../auth/session";
import { addMember, findActivePerson, listMembers, reissueLink, removeMember, setOrganizer } from "../db/people";
import { normalizePhone, smsUri } from "../domain/messages";
import type { AppEnv } from "../types";
import { Field, Layout } from "../views/layout";
import { absoluteUrl, neutral, problem, readForm } from "./http";

const memberForm = z.object({ name: z.string().trim().min(1).max(80), phone: z.string() });
const organizerForm = z.object({ on: z.enum(["0", "1"]) });

export const members = new Hono<AppEnv>();

members.use("*", async (c, next) => {
  const actor = c.get("actor");
  if (!actor) return neutral(c);
  if (!can(actor, "members.manage")) return problem(c, "Only an organizer can do that.", "/", 403);
  return next();
});

members.get("/", async (c) => {
  const actor = c.get("actor")!;
  const people = await Promise.all(
    (await listMembers(c.env.DB)).map(async (person) => ({
      person,
      link: absoluteUrl(c, `/k/${await personalToken(c.env.LINK_SECRET, person)}`),
    })),
  );
  return c.html(
    <Layout title="Members" actor={actor}>
      <h1>Members</h1>
      <p>Send each person their own link once. Anyone who opens it acts as them.</p>
      <ul class="cards">
        {people.map(({ person, link }) => {
          const message = `Hi ${person.name}, here's your Dinner Club link: ${link}`;
          const path = `/members/${person.public_id}`;
          return (
            <li>
              <h2>{person.name}{person.is_organizer ? " (organizer)" : ""}</h2>
              <p>{person.phone ?? "No phone number"}</p>
              <div class="actions">
                {person.phone && !person.texts_opt_out && (
                  <a class="button" href={smsUri([person.phone], message)}>Text link</a>
                )}
                <button type="button" data-copy={link} hidden>Copy link</button>
              </div>
              <details>
                <summary>More</summary>
                <label>Personal link <input readonly value={link} /></label>
                <form method="post" action={`${path}/reissue`}>
                  <button class="secondary">Replace link (old one stops working)</button>
                </form>
                <form method="post" action={`${path}/organizer`}>
                  <input type="hidden" name="on" value={person.is_organizer ? "0" : "1"} />
                  <button class="secondary">{person.is_organizer ? "Remove as organizer" : "Make organizer"}</button>
                </form>
                <form method="post" action={`${path}/remove`}>
                  <button class="danger">Remove {person.name} from the group</button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>
      <h2>Add a member</h2>
      <form method="post" action="/members" class="stack">
        <Field label="Name" name="name" required />
        <Field label="Phone" name="phone" type="tel" required />
        <button>Add member</button>
      </form>
    </Layout>,
  );
});

members.post("/", async (c) => {
  const form = await readForm(c, memberForm);
  const phone = form.success && normalizePhone(form.data.phone);
  if (!form.success || !phone) return problem(c, "Enter a name and a full phone number.", "/members");
  await addMember(c.env.DB, form.data.name, phone);
  return c.redirect("/members", 303);
});

members.post("/:id/reissue", async (c) => {
  const id = c.req.param("id");
  await reissueLink(c.env.DB, id);
  // Keep organizers signed in when they replace their own link.
  if (id === c.get("actor")!.person.public_id) {
    const person = await findActivePerson(c.env.DB, id);
    if (person) rememberPerson(c, await personalToken(c.env.LINK_SECRET, person));
  }
  return c.redirect("/members", 303);
});

/** Explains why an organizer change or removal did nothing: a stale page, or the last organizer. */
async function refused(c: Context<AppEnv>, publicId: string) {
  const person = await findActivePerson(c.env.DB, publicId);
  return person?.kind === "member"
    ? problem(c, "The group needs at least one organizer.", "/members", 409)
    : problem(c, "That person isn't in the group any more.", "/members", 404);
}

members.post("/:id/organizer", async (c) => {
  const form = await readForm(c, organizerForm);
  if (!form.success) return problem(c, "Try that again.", "/members");
  const id = c.req.param("id");
  if (!(await setOrganizer(c.env.DB, id, form.data.on === "1"))) return refused(c, id);
  return c.redirect("/members", 303);
});

members.post("/:id/remove", async (c) => {
  const id = c.req.param("id");
  if (!(await removeMember(c.env.DB, id))) return refused(c, id);
  return c.redirect("/members", 303);
});
