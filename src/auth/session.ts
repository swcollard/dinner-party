import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { findInvitation } from "../db/dinners";
import { findActivePerson } from "../db/people";
import type { AppEnv, Invitation, Person } from "../types";
import { secretsMatch, signToken, tokenPublicId } from "./tokens";

const PERSONAL_COOKIE = "dc";
const DINNER_COOKIE = "dc_dinner";
const MAX_AGE = 400 * 24 * 60 * 60;

export function personalToken(secret: string, person: Person): Promise<string> {
  return signToken(secret, "personal", person.public_id, String(person.link_version));
}

/** Includes the person's version, so revoking a member also ends their one-dinner links. */
export function invitationToken(
  secret: string,
  invitation: Pick<Invitation, "public_id" | "link_version">,
  person: Person,
): Promise<string> {
  return signToken(secret, "invitation", invitation.public_id, `${person.link_version}-${invitation.link_version}`);
}

export async function verifyPersonal(c: Context<AppEnv>, token: string): Promise<Person | null> {
  const publicId = tokenPublicId(token);
  if (!publicId) return null;
  const person = await findActivePerson(c.env.DB, publicId);
  if (!person || person.kind !== "member") return null;
  return (await secretsMatch(token, await personalToken(c.env.LINK_SECRET, person))) ? person : null;
}

export async function verifyInvitation(c: Context<AppEnv>, token: string) {
  const publicId = tokenPublicId(token);
  if (!publicId) return null;
  const found = await findInvitation(c.env.DB, publicId);
  if (!found) return null;
  const expected = await invitationToken(c.env.LINK_SECRET, found.invitation, found.person);
  return (await secretsMatch(token, expected)) ? found : null;
}

function cookieOptions(c: Context<AppEnv>, path: string) {
  return {
    path,
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: c.env.PUBLIC_BASE_URL.startsWith("https:") || c.req.url.startsWith("https:"),
    maxAge: MAX_AGE,
  };
}

const dinnerPath = (dinnerPublicId: string) => `/d/${dinnerPublicId}`;

export function rememberPerson(c: Context<AppEnv>, token: string): void {
  setCookie(c, PERSONAL_COOKIE, token, cookieOptions(c, "/"));
}

export function rememberInvitation(c: Context<AppEnv>, token: string, dinnerPublicId: string): void {
  setCookie(c, DINNER_COOKIE, token, cookieOptions(c, dinnerPath(dinnerPublicId)));
}

export function forgetPerson(c: Context<AppEnv>): void {
  deleteCookie(c, PERSONAL_COOKIE, { path: "/" });
}

export function forgetInvitation(c: Context<AppEnv>, dinnerPublicId: string): void {
  deleteCookie(c, DINNER_COOKIE, { path: dinnerPath(dinnerPublicId) });
}

/** On a dinner's pages, a one-dinner link for a different person wins over the personal one. */
export const loadActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("actor", null);
  const personal = getCookie(c, PERSONAL_COOKIE);
  const person = personal ? await verifyPersonal(c, personal) : null;
  if (personal && person) {
    c.set("actor", { person, scope: "full" });
    rememberPerson(c, personal);
  }

  const dinnerPublicId = /^\/d\/([^/]+)/.exec(c.req.path)?.[1];
  const token = dinnerPublicId && getCookie(c, DINNER_COOKIE);
  if (token) {
    const found = await verifyInvitation(c, token);
    if (found?.dinnerPublicId === dinnerPublicId && found.person.id !== person?.id) {
      c.set("actor", { person: found.person, scope: "dinner", dinnerId: found.invitation.dinner_id });
      rememberInvitation(c, token, dinnerPublicId);
    }
  }
  await next();
};
