import { randomId } from "../auth/tokens";
import type { Dinner, Invitation, Person } from "../types";

export type Invitee = Person & { invitation: Pick<Invitation, "public_id" | "link_version" | "rsvp"> };

export function findDinner(db: D1Database, publicId: string): Promise<(Dinner & { host_name: string }) | null> {
  return db
    .prepare("SELECT d.*, p.name AS host_name FROM dinners d JOIN people p ON p.id = d.host_id WHERE d.public_id = ?")
    .bind(publicId)
    .first<Dinner & { host_name: string }>();
}

export async function listDinners(db: D1Database): Promise<(Dinner & { host_name: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT d.*, p.name AS host_name FROM dinners d JOIN people p ON p.id = d.host_id
       ORDER BY d.starts_at IS NULL, d.starts_at`,
    )
    .all<Dinner & { host_name: string }>();
  return results;
}

/** Creates a confirmed dinner, invites every current member, and seats the host. */
export async function createDinner(
  db: D1Database,
  hostId: number,
  memberIds: number[],
  input: { title: string; startsAt: number; location: string; note: string },
): Promise<string> {
  const publicId = randomId();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO dinners (public_id, host_id, title, starts_at, location, note, status) VALUES (?, ?, ?, ?, ?, ?, 'confirmed')",
      )
      .bind(publicId, hostId, input.title, input.startsAt, input.location, input.note),
    ...memberIds.map((id) =>
      db
        .prepare(
          `INSERT INTO invitations (public_id, dinner_id, person_id)
           SELECT ?, id, ? FROM dinners WHERE public_id = ?`,
        )
        .bind(randomId(), id, publicId),
    ),
    db
      .prepare(
        `UPDATE invitations SET rsvp = 'yes', replied_at = ?
         WHERE person_id = ? AND dinner_id = (SELECT id FROM dinners WHERE public_id = ?)`,
      )
      .bind(now, hostId, publicId),
    db
      .prepare(
        `INSERT INTO attendees (dinner_id, invitation_id, person_id, queued_at)
         SELECT i.dinner_id, i.id, i.person_id, ? FROM invitations i JOIN dinners d ON d.id = i.dinner_id
         WHERE i.person_id = ? AND d.public_id = ?`,
      )
      .bind(now, hostId, publicId),
  ]);
  return publicId;
}

export async function addGuest(db: D1Database, dinnerId: number, name: string, phone: string | null): Promise<void> {
  const personId = randomId();
  await db.batch([
    db
      .prepare("INSERT INTO people (public_id, kind, name, phone) VALUES (?, 'guest', ?, ?)")
      .bind(personId, name, phone),
    db
      .prepare(
        "INSERT INTO invitations (public_id, dinner_id, person_id) SELECT ?, ?, id FROM people WHERE public_id = ?",
      )
      .bind(randomId(), dinnerId, personId),
  ]);
}

export async function listInvitees(db: D1Database, dinnerId: number): Promise<Invitee[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, i.public_id AS inv_public_id, i.link_version AS inv_link_version, i.rsvp
       FROM invitations i JOIN people p ON p.id = i.person_id
       WHERE i.dinner_id = ? AND p.removed_at IS NULL ORDER BY p.name COLLATE NOCASE`,
    )
    .bind(dinnerId)
    .all<Person & { inv_public_id: string; inv_link_version: number; rsvp: Invitation["rsvp"] }>();
  return results.map(({ inv_public_id, inv_link_version, rsvp, ...person }) => ({
    ...person,
    invitation: { public_id: inv_public_id, link_version: inv_link_version, rsvp },
  }));
}

export async function findInvitation(
  db: D1Database,
  publicId: string,
): Promise<{ invitation: Invitation; person: Person; dinnerPublicId: string } | null> {
  const invitation = await db
    .prepare("SELECT i.*, d.public_id AS dinner_public_id FROM invitations i JOIN dinners d ON d.id = i.dinner_id WHERE i.public_id = ?")
    .bind(publicId)
    .first<Invitation & { dinner_public_id: string }>();
  if (!invitation) return null;
  const person = await db
    .prepare("SELECT * FROM people WHERE id = ? AND removed_at IS NULL")
    .bind(invitation.person_id)
    .first<Person>();
  return person && { invitation, person, dinnerPublicId: invitation.dinner_public_id };
}

export async function reissueInvitation(db: D1Database, dinnerId: number, publicId: string): Promise<void> {
  await db
    .prepare("UPDATE invitations SET link_version = link_version + 1 WHERE dinner_id = ? AND public_id = ?")
    .bind(dinnerId, publicId)
    .run();
}
