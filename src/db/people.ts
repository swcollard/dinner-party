import { randomId } from "../auth/tokens";
import type { GroupSettings, Person } from "../types";

export function getSettings(db: D1Database): Promise<GroupSettings | null> {
  return db.prepare("SELECT * FROM group_settings WHERE id = 1").first<GroupSettings>();
}

/** Returns the organizer's public id, or null if the group already exists. */
export async function createGroup(
  db: D1Database,
  group: { name: string; timeZone: string },
  organizer: { name: string; phone: string | null },
): Promise<string | null> {
  if (await getSettings(db)) return null;
  const publicId = randomId();
  // Main is the host's; the rest are open to claim.
  const courses = JSON.stringify([
    { name: "Starter", slots: 1 },
    { name: "Main", slots: 1, host: true },
    { name: "Sides", slots: 2 },
    { name: "Dessert", slots: 1 },
    { name: "Drinks", slots: 2 },
  ]);
  try {
    // A batch is a transaction, and id = 1 is unique, so simultaneous setups can't both win.
    await db.batch([
      db
        .prepare("INSERT INTO group_settings (id, name, time_zone, default_courses) VALUES (1, ?, ?, ?)")
        .bind(group.name, group.timeZone, courses),
      db
        .prepare("INSERT INTO people (public_id, kind, name, phone, is_organizer) VALUES (?, 'member', ?, ?, 1)")
        .bind(publicId, organizer.name, organizer.phone),
    ]);
  } catch (error) {
    if (await getSettings(db)) return null;
    throw error;
  }
  return publicId;
}

export function findActivePerson(db: D1Database, publicId: string): Promise<Person | null> {
  return db
    .prepare("SELECT * FROM people WHERE public_id = ? AND removed_at IS NULL")
    .bind(publicId)
    .first<Person>();
}

export async function listMembers(db: D1Database): Promise<Person[]> {
  const { results } = await db
    .prepare("SELECT * FROM people WHERE kind = 'member' AND removed_at IS NULL ORDER BY name COLLATE NOCASE")
    .all<Person>();
  return results;
}

export async function addMember(db: D1Database, name: string, phone: string): Promise<void> {
  await db
    .prepare("INSERT INTO people (public_id, kind, name, phone) VALUES (?, 'member', ?, ?)")
    .bind(randomId(), name, phone)
    .run();
}

export async function reissueLink(db: D1Database, publicId: string): Promise<void> {
  await db
    .prepare("UPDATE people SET link_version = link_version + 1 WHERE public_id = ? AND kind = 'member' AND removed_at IS NULL")
    .bind(publicId)
    .run();
}

/** Changes nothing if it would leave the group without an organizer. */
const KEEPS_AN_ORGANIZER =
  "EXISTS (SELECT 1 FROM people o WHERE o.is_organizer = 1 AND o.removed_at IS NULL AND o.id <> people.id)";

export async function setOrganizer(db: D1Database, publicId: string, on: boolean): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE people SET is_organizer = ?1 WHERE public_id = ?2 AND kind = 'member'
       AND removed_at IS NULL AND (?1 = 1 OR ${KEEPS_AN_ORGANIZER})`,
    )
    .bind(on ? 1 : 0, publicId)
    .run();
  return result.meta.changes > 0;
}

export async function removeMember(db: D1Database, publicId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE people SET removed_at = ?, is_organizer = 0, link_version = link_version + 1
       WHERE public_id = ? AND kind = 'member' AND removed_at IS NULL AND ${KEEPS_AN_ORGANIZER}`,
    )
    .bind(Date.now(), publicId)
    .run();
  return result.meta.changes > 0;
}
