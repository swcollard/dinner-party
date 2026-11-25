import type { Need } from "../domain/diet";
import type { Seat } from "../domain/seats";
import type { Invitation } from "../types";

export type Attendee = Seat & { name: string; plus_one_of: string | null; diet: Need[] };

/** Everyone who wants a seat: people who said yes, and their plus-ones. */
export async function listAttendees(db: D1Database, dinnerId: number): Promise<Attendee[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.invitation_id, a.person_id, a.queued_at, a.diet,
              COALESCE(a.plus_one_name, p.name) AS name,
              CASE WHEN a.person_id IS NULL THEN p.name END AS plus_one_of
       FROM attendees a
       JOIN invitations i ON i.id = a.invitation_id
       JOIN people p ON p.id = i.person_id
       WHERE a.dinner_id = ? AND i.rsvp = 'yes' AND p.removed_at IS NULL`,
    )
    .bind(dinnerId)
    .all<Omit<Attendee, "diet"> & { diet: string }>();
  return results.map((a) => ({ ...a, diet: JSON.parse(a.diet) as Need[] }));
}

export function findOwnInvitation(db: D1Database, dinnerId: number, personId: number): Promise<Invitation | null> {
  return db
    .prepare("SELECT * FROM invitations WHERE dinner_id = ? AND person_id = ?")
    .bind(dinnerId, personId)
    .first<Invitation>();
}

/** Saying yes again keeps the original place in line; coming back after a no rejoins at the end. */
export async function setRsvp(
  db: D1Database,
  invitation: Invitation,
  rsvp: NonNullable<Invitation["rsvp"]>,
  now = Date.now(),
): Promise<void> {
  const reply = db
    .prepare("UPDATE invitations SET rsvp = ?, replied_at = ? WHERE id = ?")
    .bind(rsvp, now, invitation.id);
  if (rsvp !== "yes") {
    await db.batch([
      reply,
      db.prepare("DELETE FROM attendees WHERE invitation_id = ? AND person_id IS NOT NULL").bind(invitation.id),
    ]);
    return;
  }
  await db.batch([
    reply,
    db
      .prepare(
        `UPDATE attendees SET queued_at = ?1 WHERE invitation_id = ?2 AND person_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM attendees s WHERE s.invitation_id = ?2 AND s.person_id IS NOT NULL)`,
      )
      .bind(now, invitation.id),
    db
      .prepare("INSERT OR IGNORE INTO attendees (dinner_id, invitation_id, person_id, queued_at) VALUES (?, ?, ?, ?)")
      .bind(invitation.dinner_id, invitation.id, invitation.person_id, now),
  ]);
}

const MAX_PLUS_ONES = 10;

/** Adds nothing unless the invitation is a yes with room for more plus-ones. */
export async function addPlusOne(db: D1Database, invitationId: number, name: string, diet: Need[]): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO attendees (dinner_id, invitation_id, plus_one_name, diet, queued_at)
       SELECT dinner_id, id, ?, ?, ? FROM invitations i WHERE id = ? AND rsvp = 'yes'
       AND (SELECT COUNT(*) FROM attendees a WHERE a.invitation_id = i.id AND a.person_id IS NULL) < ${MAX_PLUS_ONES}`,
    )
    .bind(name, JSON.stringify(diet), Date.now(), invitationId)
    .run();
  return result.meta.changes > 0;
}

/** Edits in place, so a plus-one keeps their spot in line. */
export async function updatePlusOne(
  db: D1Database,
  invitationId: number,
  attendeeId: number,
  name: string,
  diet: Need[],
): Promise<void> {
  await db
    .prepare("UPDATE attendees SET plus_one_name = ?, diet = ? WHERE id = ? AND invitation_id = ? AND person_id IS NULL")
    .bind(name, JSON.stringify(diet), attendeeId, invitationId)
    .run();
}

export async function removePlusOne(db: D1Database, invitationId: number, attendeeId: number): Promise<void> {
  await db
    .prepare("DELETE FROM attendees WHERE id = ? AND invitation_id = ? AND person_id IS NULL")
    .bind(attendeeId, invitationId)
    .run();
}
