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

/** Replace all of a member's links with a fresh one. */
export async function reissueLink(db: D1Database, groupId: string, memberId: string): Promise<string> {
  const token = generateToken();
  await db.batch([
    db
      .prepare("UPDATE access_tokens SET revoked_at = datetime('now') WHERE member_id = ? AND revoked_at IS NULL")
      .bind(memberId),
    db
      .prepare("INSERT INTO access_tokens (token_hash, group_id, member_id) VALUES (?, ?, ?)")
      .bind(await hashToken(token), groupId, memberId),
  ]);
  return token;
}

/** The URL a member opens on their phone. The token is in the fragment, so it is never sent to a server. */
export const memberLink = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/$/, "")}/#t=${token}`;
