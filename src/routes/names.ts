import { z } from "zod";

/** Spaces trimmed and collapsed, so "Bo" and " Bo " can't pass as two different people. */
export const personName = z
  .string()
  .transform((name) => name.normalize("NFKC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(80));

export const NAME_TAKEN = "Someone in the group already goes by that name. Add an initial to tell them apart.";

/** The database refuses two current members with the same name, ignoring case (people_member_name). */
export function isNameTaken(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
