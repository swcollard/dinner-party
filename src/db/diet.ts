import type { Need } from "../domain/diet";

export async function listNeeds(db: D1Database, personId: number): Promise<Need[]> {
  const { results } = await db
    .prepare("SELECT kind, label FROM dietary_needs WHERE person_id = ? ORDER BY id")
    .bind(personId)
    .all<Need>();
  return results;
}

/** Needs of every person invited to a dinner, by person id. */
export async function needsForDinner(db: D1Database, dinnerId: number): Promise<Map<number, Need[]>> {
  const { results } = await db
    .prepare(
      `SELECT n.person_id, n.kind, n.label FROM dietary_needs n
       JOIN invitations i ON i.person_id = n.person_id WHERE i.dinner_id = ? ORDER BY n.id`,
    )
    .bind(dinnerId)
    .all<Need & { person_id: number }>();
  const byPerson = new Map<number, Need[]>();
  for (const { person_id, kind, label } of results) {
    byPerson.set(person_id, [...(byPerson.get(person_id) ?? []), { kind, label }]);
  }
  return byPerson;
}

function replaceNeeds(db: D1Database, personId: number, needs: Need[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM dietary_needs WHERE person_id = ?").bind(personId),
    ...needs.map((n) =>
      db.prepare("INSERT INTO dietary_needs (person_id, kind, label) VALUES (?, ?, ?)").bind(personId, n.kind, n.label),
    ),
  ];
}

export async function saveNeeds(db: D1Database, personId: number, needs: Need[]): Promise<void> {
  await db.batch(replaceNeeds(db, personId, needs));
}

export async function saveProfile(
  db: D1Database,
  personId: number,
  profile: { name: string; phone: string | null; textsOptOut: boolean },
  needs: Need[],
): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE people SET name = ?, phone = ?, texts_opt_out = ? WHERE id = ?")
      .bind(profile.name, profile.phone, profile.textsOptOut ? 1 : 0, personId),
    ...replaceNeeds(db, personId, needs),
  ]);
}
