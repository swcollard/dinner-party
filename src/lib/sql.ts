/**
 * Build a partial UPDATE from a patch. `columns` maps patch keys to column
 * names and is the allow-list: only keys present there (and not undefined in
 * the patch) are written. Table and column names must be code constants.
 * Returns null when there is nothing to update.
 */
export function updateStatement(
  db: D1Database,
  table: string,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
  where: string,
  whereArgs: unknown[],
): D1PreparedStatement | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }
  if (sets.length === 0) return null;
  return db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${where}`).bind(...values, ...whereArgs);
}

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
