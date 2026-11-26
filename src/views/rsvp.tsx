import type { Invitee } from "../db/dinners";
import type { Attendee } from "../db/rsvps";
import type { Invitation, Person } from "../types";
import { NeedFields } from "./diet";
import { Field } from "./layout";

const CHOICES = [
  { value: "yes", label: "✓ Yes" },
  { value: "maybe", label: "? Maybe" },
  { value: "no", label: "✕ No" },
] as const;

const REPLIES = { yes: "You're coming.", maybe: "You said maybe.", no: "You said no." };

const attendeeName = (a: Attendee) => (a.plus_one_of ? `${a.name} (with ${a.plus_one_of})` : a.name);

export function RsvpPanel(props: {
  path: string;
  person: Person;
  invitation: Invitation;
  open: boolean;
  hosting: boolean;
  seated: Attendee[];
  waitlist: Attendee[];
}) {
  const { path, person, invitation, open, hosting, seated, waitlist } = props;
  // A host who somehow isn't a yes still needs a way to become one.
  const choices = hosting ? CHOICES.filter(({ value }) => value === "yes" && invitation.rsvp !== "yes") : CHOICES;
  const mine = (a: Attendee) => a.invitation_id === invitation.id;
  const place = waitlist.findIndex((a) => a.person_id === person.id) + 1;
  const plusOnes = [...seated, ...waitlist].filter((a) => mine(a) && a.person_id === null);
  return (
    <section>
      <h2>{hosting ? "You're hosting" : "Are you coming?"}</h2>
      <p role="status">
        {place > 0
          ? `You're number ${place} on the waitlist.`
          : invitation.rsvp
            ? REPLIES[invitation.rsvp]
            : "You haven't replied yet."}
      </p>
      {!open && <p>Replies are closed.</p>}
      {open && choices.length > 0 && (
        <form method="post" action={`${path}/rsvp`} class="choices">
          {choices.map(({ value, label }) => (
            <button
              name="rsvp"
              value={value}
              aria-pressed={invitation.rsvp === value ? "true" : "false"}
              class={invitation.rsvp === value ? "" : "secondary"}
            >
              {label}
            </button>
          ))}
        </form>
      )}
      {invitation.rsvp === "yes" && person.kind === "member" && (
        <>
          <ul class="rows">
            {plusOnes.map((a) => (
              <li>
                <span>{a.name}{waitlist.includes(a) ? " (waitlist)" : ""}</span>
                {open && (
                  <form method="post" action={`${path}/plus-ones/${a.id}/remove`}>
                    <button class="link" aria-label={`Remove ${a.name}`}>Remove</button>
                  </form>
                )}
                {open && (
                  <details>
                    <summary>Edit {a.name}</summary>
                    <form method="post" action={`${path}/plus-ones/${a.id}/edit`} class="stack">
                      <Field label="Their name" name="name" value={a.name} required />
                      <NeedFields needs={a.diet} />
                      <button>Save</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {open && (
            <details>
              <summary>Bringing someone?</summary>
              <form method="post" action={`${path}/plus-ones`} class="stack">
                <Field label="Their name" name="name" required />
                <details>
                  <summary>Dietary restrictions (optional)</summary>
                  <NeedFields needs={[]} />
                </details>
                <button>Add plus-one</button>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Names(props: { title: string; names: string[] }) {
  if (props.names.length === 0) return null;
  return <p><strong>{props.title} ({props.names.length}):</strong> {props.names.join(", ")}</p>;
}

export function WhosComing(props: { seated: Attendee[]; waitlist: Attendee[]; capacity: number | null; invitees: Invitee[] }) {
  const replied = (rsvp: Invitation["rsvp"]) =>
    props.invitees.filter((p) => p.invitation.rsvp === rsvp).map((p) => p.name);
  return (
    <section>
      <h2>Who's coming</h2>
      <p>
        {props.seated.length} coming
        {props.capacity !== null && ` of ${props.capacity} seats`}
      </p>
      <Names title="Coming" names={props.seated.map(attendeeName)} />
      <Names title="Waitlist" names={props.waitlist.map(attendeeName)} />
      <Names title="Maybe" names={replied("maybe")} />
      <Names title="Not coming" names={replied("no")} />
      <Names title="No reply" names={replied(null)} />
    </section>
  );
}
