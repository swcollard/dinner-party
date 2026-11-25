import { Hono } from "hono";
import { z } from "zod";
import { can } from "../auth/permissions";
import { forgetInvitation, forgetPerson, invitationToken } from "../auth/session";
import {
  addGuest,
  createDinner,
  listDinners,
  listInvitees,
  reissueInvitation,
  setCancelled,
  updateDinner,
} from "../db/dinners";
import { getSettings, listMembers } from "../db/people";
import { findOwnInvitation, listAttendees } from "../db/rsvps";
import { normalizePhone, smsUri, whatsappUri } from "../domain/messages";
import { assignSeats } from "../domain/seats";
import { formatDateTime, isPast, localToUtc, utcToLocal } from "../domain/time";
import type { AppEnv, Dinner } from "../types";
import { Field, Layout } from "../views/layout";
import { RsvpPanel, WhosComing } from "../views/rsvp";
import { absoluteUrl, neutral, problem, readForm } from "./http";
import { loadDinner } from "./load";

const dinnerForm = z.object({
  title: z.string().trim().min(1).max(120),
  startsAt: z.string(),
  location: z.string().trim().max(300),
  note: z.string().trim().max(2000),
  capacity: z.union([
    z.literal("").transform(() => null),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(500)),
  ]),
  rsvpClosed: z.literal("on").optional(),
  confirmed: z.literal("1").optional(),
});
const guestForm = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim() });

function DinnerFields(props: { dinner?: Dinner; timeZone?: string }) {
  const { dinner, timeZone } = props;
  const startsAt = dinner?.starts_at && timeZone ? utcToLocal(dinner.starts_at, timeZone) : undefined;
  return (
    <>
      <Field label="Title" name="title" value={dinner?.title} required />
      <Field label="Date and time" name="startsAt" type="datetime-local" value={startsAt} required />
      <Field label="Place (optional)" name="location" value={dinner?.location} />
      <Field label="Seats, including plus-ones (optional)" name="capacity" type="number" value={dinner?.capacity?.toString()} />
      <label>Note (optional) <textarea name="note" rows={3}>{dinner?.note}</textarea></label>
    </>
  );
}

function CancelledBanner() {
  return <p role="status"><strong>✕ This dinner is cancelled.</strong></p>;
}

const when = (dinner: Dinner, timeZone: string) =>
  dinner.starts_at === null ? "Date to be decided" : formatDateTime(dinner.starts_at, timeZone);

export const dinners = new Hono<AppEnv>();

dinners.get("/", async (c) => {
  const actor = c.get("actor");
  const settings = await getSettings(c.env.DB);
  if (!actor || !settings) return neutral(c);
  const upcoming = (await listDinners(c.env.DB)).filter((d) => !isPast(d.starts_at, settings.time_zone));
  return c.html(
    <Layout title={settings.name} actor={actor}>
      <h1>{settings.name}</h1>
      {upcoming.length === 0 && <p>No dinners planned yet.</p>}
      <ul class="cards">
        {upcoming.map((dinner) => (
          <li>
            <h2><a href={`/d/${dinner.public_id}`}>{dinner.title}</a></h2>
            <p>{when(dinner, settings.time_zone)}</p>
            <p>Host: {dinner.host_name}</p>
            {dinner.status === "cancelled" && <p><strong>✕ Cancelled</strong></p>}
          </li>
        ))}
      </ul>
      <div class="actions">
        <a class="button" href="/new">New dinner</a>
        {can(actor, "members.manage") && <a class="button secondary" href="/members">Members</a>}
      </div>
    </Layout>,
  );
});

dinners.get("/new", (c) => {
  const actor = c.get("actor");
  if (!can(actor, "dinner.create")) return neutral(c);
  return c.html(
    <Layout title="New dinner" actor={actor}>
      <h1>New dinner</h1>
      <form method="post" action="/new" class="stack">
        <DinnerFields />
        <button>Create dinner</button>
      </form>
    </Layout>,
  );
});

const FORM_HELP = "Add a title, date and time. Seats must be a whole number, or blank for no limit.";
const PAST_HELP = "That day has already passed. Choose today or later.";

dinners.post("/new", async (c) => {
  const actor = c.get("actor");
  const settings = await getSettings(c.env.DB);
  if (!actor || !settings || !can(actor, "dinner.create")) return neutral(c);
  const form = await readForm(c, dinnerForm);
  const startsAt = form.success ? localToUtc(form.data.startsAt, settings.time_zone) : null;
  if (!form.success || startsAt === null) return problem(c, FORM_HELP, "/new");
  if (isPast(startsAt, settings.time_zone)) return problem(c, PAST_HELP, "/new");
  const memberIds = (await listMembers(c.env.DB)).map((m) => m.id);
  const id = await createDinner(c.env.DB, actor.person.id, memberIds, { ...form.data, startsAt });
  return c.redirect(`/d/${id}`, 303);
});

dinners.get("/d/:id/edit", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "dinner.edit");
  if (!loaded) return neutral(c);
  const { actor, dinner, settings, path } = loaded;
  const cancelled = dinner.status === "cancelled";
  return c.html(
    <Layout title="Edit dinner" actor={actor} forgetPath={`${path}/forget`}>
      <h1>Edit dinner</h1>
      {cancelled && <CancelledBanner />}
      <p><a href={path}>Back to {dinner.title}</a></p>
      <form method="post" action={`${path}/edit`} class="stack">
        <DinnerFields dinner={dinner} timeZone={settings.time_zone} />
        <label class="check">
          <input type="checkbox" name="rsvpClosed" checked={!!dinner.rsvp_closed} /> Close replies
        </label>
        <button>Save</button>
      </form>
      <form method="post" action={`${path}/${cancelled ? "restore" : "cancel"}`}>
        {cancelled ? (
          <button class="secondary">Bring this dinner back</button>
        ) : (
          <details>
            <summary>Cancel this dinner</summary>
            <p>Replies are kept, and you can bring it back later.</p>
            <button class="danger">Cancel dinner</button>
          </details>
        )}
      </form>
    </Layout>,
  );
});

dinners.post("/d/:id/edit", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "dinner.edit");
  if (!loaded) return neutral(c);
  const { actor, dinner, settings, path } = loaded;
  const back = `${path}/edit`;
  const form = await readForm(c, dinnerForm);
  const startsAt = form.success ? localToUtc(form.data.startsAt, settings.time_zone) : null;
  if (!form.success || startsAt === null) return problem(c, FORM_HELP, back);
  // A past date would lock the host out of fixing it. Organizers can always correct history.
  if (isPast(startsAt, settings.time_zone) && !can(actor, "dinner.edit", { ...dinner, past: true })) {
    return problem(c, PAST_HELP, back);
  }

  const { capacity } = form.data;
  const { seated } = assignSeats(await listAttendees(c.env.DB, dinner.id), dinner.capacity);
  if (capacity !== null && capacity < seated.length && !form.data.confirmed) {
    const bumped = assignSeats(seated, capacity).waitlist;
    return c.html(
      <Layout title="Fewer seats" actor={actor} forgetPath={`${path}/forget`}>
        <h1>Move {bumped.length} to the waitlist?</h1>
        <p>{seated.length} people have seats. With {capacity}, these would move: {bumped.map((a) => a.name).join(", ")}.</p>
        <form method="post" action={back} class="actions">
          <input type="hidden" name="title" value={form.data.title} />
          <input type="hidden" name="startsAt" value={form.data.startsAt} />
          <input type="hidden" name="location" value={form.data.location} />
          <textarea name="note" hidden>{form.data.note}</textarea>
          <input type="hidden" name="capacity" value={String(capacity)} />
          {form.data.rsvpClosed && <input type="hidden" name="rsvpClosed" value="on" />}
          <input type="hidden" name="confirmed" value="1" />
          <button>Move them</button>
          <a class="button secondary" href={back}>Go back</a>
        </form>
      </Layout>,
    );
  }
  // TODO(milestone 5): add notices for people moved to the waitlist and for date, time or place changes.
  await updateDinner(c.env.DB, dinner.id, { ...form.data, startsAt, rsvpClosed: !!form.data.rsvpClosed });
  return c.redirect(path, 303);
});

for (const action of ["cancel", "restore"] as const) {
  dinners.post(`/d/:id/${action}`, async (c) => {
    const loaded = await loadDinner(c, c.req.param("id")!, "dinner.edit");
    if (!loaded) return neutral(c);
    // TODO(milestone 5): add notices for everyone who said yes.
    await setCancelled(c.env.DB, loaded.dinner.id, action === "cancel");
    return c.redirect(loaded.path, 303);
  });
}

dinners.get("/d/:id", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "dinner.view");
  if (!loaded) return neutral(c);
  const { actor, dinner, settings, path } = loaded;
  const [invitation, attendees, invitees] = await Promise.all([
    findOwnInvitation(c.env.DB, dinner.id, actor.person.id),
    listAttendees(c.env.DB, dinner.id),
    listInvitees(c.env.DB, dinner.id),
  ]);
  const { seated, waitlist } = assignSeats(attendees, dinner.capacity);
  const open = dinner.status === "confirmed" && !dinner.rsvp_closed && can(actor, "rsvp.own", dinner);
  return c.html(
    <Layout title={dinner.title} actor={actor} forgetPath={`${path}/forget`}>
      <h1>{dinner.title}</h1>
      {dinner.status === "cancelled" && <CancelledBanner />}
      <p>{when(dinner, settings.time_zone)}</p>
      <p>Host: {dinner.host_name}</p>
      {dinner.location && (
        <p>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dinner.location)}`}>
            {dinner.location}
          </a>
        </p>
      )}
      {dinner.note && <p class="note">{dinner.note}</p>}
      {invitation && !dinner.past && (
        <RsvpPanel {...{ path, invitation, open, seated, waitlist }} person={actor.person} hosting={dinner.host_id === actor.person.id} />
      )}
      <WhosComing {...{ seated, waitlist, invitees }} capacity={dinner.capacity} />
      <div class="actions">
        {can(actor, "announce", dinner) && dinner.status === "confirmed" && (
          <a class="button" href={`${path}/send`}>Send invite</a>
        )}
        {can(actor, "dinner.edit", dinner) && <a class="button secondary" href={`${path}/edit`}>Edit dinner</a>}
      </div>
    </Layout>,
  );
});

dinners.post("/d/:id/forget", (c) => {
  // Drop only the identity shown; a one-dinner link sits on top of the personal one.
  if (c.get("actor")?.scope === "dinner") forgetInvitation(c, c.req.param("id"));
  else forgetPerson(c);
  return c.redirect(`/d/${c.req.param("id")}`, 303);
});

dinners.get("/d/:id/send", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "announce");
  if (!loaded) return neutral(c);
  const { actor, dinner, settings, path } = loaded;
  const text = (link: string) =>
    `${dinner.host_name} is hosting ${dinner.title}, ${when(dinner, settings.time_zone)}. Tap to RSVP: ${link}`;
  const groupMessage = text(absoluteUrl(c, path));
  const others = (await listInvitees(c.env.DB, dinner.id)).filter((p) => p.id !== actor.person.id);
  // Guests have no personal link, so the group link wouldn't work for them.
  const groupPhones = others
    .filter((p) => p.kind === "member" && p.phone && !p.texts_opt_out)
    .map((p) => p.phone!);
  const individual = await Promise.all(
    others.map(async (person) => ({
      person,
      link: absoluteUrl(c, `/i/${await invitationToken(c.env.LINK_SECRET, person.invitation, person)}`),
    })),
  );
  return c.html(
    <Layout title="Send invite" actor={actor} forgetPath={`${path}/forget`}>
      <h1>Send invite</h1>
      <p><a href={path}>Back to {dinner.title}</a></p>
      <h2>To the group</h2>
      <p class="note">{groupMessage}</p>
      <div class="actions">
        <button type="button" data-share={groupMessage} hidden>Share</button>
        <a class="button" href={whatsappUri(groupMessage)}>WhatsApp</a>
        {groupPhones.length > 0 && (
          <a class="button" href={smsUri(groupPhones, groupMessage, c.req.header("User-Agent"))}>
            Text {groupPhones.length} people
          </a>
        )}
        <button type="button" class="secondary" data-copy={groupMessage} hidden>Copy</button>
      </div>
      <h2>One by one</h2>
      <p>These links open only this dinner, already signed in as that person.</p>
      <ul class="cards">
        {individual.map(({ person, link }) => (
          <li>
            <h3>{person.name}{person.kind === "guest" ? " (guest)" : ""}</h3>
            <div class="actions">
              {person.phone && !person.texts_opt_out && (
                <a class="button" href={smsUri([person.phone], text(link))}>Text</a>
              )}
              <button type="button" class="secondary" data-copy={text(link)} hidden>Copy</button>
            </div>
            <details>
              <summary>More</summary>
              <label>One-dinner link <input readonly value={link} /></label>
              <form method="post" action={`${path}/invitations/${person.invitation.public_id}/reissue`}>
                <button class="secondary">Replace link (old one stops working)</button>
              </form>
            </details>
          </li>
        ))}
      </ul>
      <h2>Add a guest</h2>
      <form method="post" action={`${path}/guests`} class="stack">
        <Field label="Name" name="name" required />
        <Field label="Phone (optional)" name="phone" type="tel" />
        <button>Add guest</button>
      </form>
    </Layout>,
  );
});

dinners.post("/d/:id/guests", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "announce");
  if (!loaded) return neutral(c);
  const back = `${loaded.path}/send`;
  const form = await readForm(c, guestForm);
  if (!form.success) return problem(c, "Enter the guest's name.", back);
  const phone = form.data.phone ? normalizePhone(form.data.phone) : null;
  if (form.data.phone && !phone) return problem(c, "That phone number doesn't look right.", back);
  await addGuest(c.env.DB, loaded.dinner.id, form.data.name, phone);
  return c.redirect(back, 303);
});

dinners.post("/d/:id/invitations/:invitation/reissue", async (c) => {
  const loaded = await loadDinner(c, c.req.param("id"), "announce");
  if (!loaded) return neutral(c);
  await reissueInvitation(c.env.DB, loaded.dinner.id, c.req.param("invitation"));
  return c.redirect(`${loaded.path}/send`, 303);
});
