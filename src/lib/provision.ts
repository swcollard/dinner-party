import { generateToken, hashToken } from "./tokens";

export interface NewMember {
  groupId: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "admin" | "member";
}

/**
 * Create a member at the end of the rotation, with a personal access token and a
 * calendar token. `before` statements run first in the same atomic batch (used to
 * create the group together with its first admin). The access token is only
 * returned here; the database keeps its hash.
 */
export async function provisionMember(
  db: D1Database,
  m: NewMember,
  before: D1PreparedStatement[] = [],
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = generateToken();
  await db.batch([
    ...before,
    db
      .prepare(
        `INSERT INTO members (id, group_id, name, email, phone, role, calendar_token, rotation_position)
         VALUES (?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(rotation_position), -1) + 1 FROM members WHERE group_id = ?))`,
      )
      .bind(id, m.groupId, m.name, m.email.trim().toLowerCase(), m.phone ?? null, m.role, generateToken(), m.groupId),
    db
      .prepare("INSERT INTO access_tokens (token_hash, group_id, member_id) VALUES (?, ?, ?)")
      .bind(await hashToken(token), m.groupId, id),
  ]);
  return { id, token };
}

/**
 * Replace a member's links with a fresh one, and rotate their calendar token too:
 * the calendar URL exposes host addresses, so a leaked or lost-phone situation
 * must cut that off as well (the member re-subscribes using the URL in /api/me).
 *
 * The new token is stored first and the old ones are revoked only after
 * `deliver` succeeds, so a failed delivery never locks the member out.
 */
export async function reissueLink(
  db: D1Database,
  groupId: string,
  memberId: string,
  deliver?: (token: string) => Promise<void>,
): Promise<string> {
  const token = generateToken();
  const hash = await hashToken(token);
  await db
    .prepare("INSERT INTO access_tokens (token_hash, group_id, member_id) VALUES (?, ?, ?)")
    .bind(hash, groupId, memberId)
    .run();
  try {
    await deliver?.(token);
  } catch (e) {
    await db.prepare("DELETE FROM access_tokens WHERE token_hash = ?").bind(hash).run();
    throw e;
  }
  await db.batch([
    db
      .prepare(
        "UPDATE access_tokens SET revoked_at = datetime('now') WHERE member_id = ? AND token_hash != ? AND revoked_at IS NULL",
      )
      .bind(memberId, hash),
    db.prepare("UPDATE members SET calendar_token = ? WHERE id = ?").bind(generateToken(), memberId),
  ]);
  return token;
}

/** The URL a member opens on their phone. The token is in the fragment, so it is never sent to a server. */
export const memberLink = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/$/, "")}/#t=${token}`;
