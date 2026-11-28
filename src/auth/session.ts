import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { findInvitation } from "../db/dinners";
import { findActivePerson } from "../db/people";
import type { AppEnv, Invitation, Person } from "../types";
import { secretsMatch, signToken, tokenPublicId } from "./tokens";

const DAY = 24 * 60 * 60 * 1000;
const MAX_AGE = 400 * 24 * 60 * 60;

/** One-dinner links stop working this long after the dinner. Guests aren't part of the group. */
export const ONE_DINNER_LINK_DAYS = 7;

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

/** When a one-dinner link stops working, or null while its dinner has no date. */
export function invitationExpiresAt(dinnerStartsAt: number | null): number | null {
  return dinnerStartsAt === null ? null : dinnerStartsAt + ONE_DINNER_LINK_DAYS * DAY;
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
  const expiresAt = invitationExpiresAt(found.dinnerStartsAt);
  if (expiresAt !== null && Date.now() >= expiresAt) return null;
  const expected = await invitationToken(c.env.LINK_SECRET, found.invitation, found.person);
  return (await secretsMatch(token, expected)) ? found : null;
}

function isSecure(c: Context<AppEnv>): boolean {
  return c.env.PUBLIC_BASE_URL.startsWith("https:") || c.req.url.startsWith("https:");
}

/**
 * Over HTTPS, the __Host- prefix makes browsers refuse versions of these cookies set by other
 * subdomains. Plain HTTP (local development, a phone on the same Wi-Fi) can't use it.
 */
function cookieName(c: Context<AppEnv>, name: string): string {
  return isSecure(c) ? `__Host-${name}` : name;
}

const personalCookie = (c: Context<AppEnv>) => cookieName(c, "dc");
// One cookie per dinner, so the browser sends it to /i/ links too and a switch can be confirmed.
const dinnerCookie = (c: Context<AppEnv>, dinnerPublicId: string) => cookieName(c, `dc_${dinnerPublicId}`);

function cookieOptions(c: Context<AppEnv>, maxAge = MAX_AGE) {
  return { path: "/", httpOnly: true, sameSite: "Lax" as const, secure: isSecure(c), maxAge };
}

export function rememberPerson(c: Context<AppEnv>, token: string): void {
  setCookie(c, personalCookie(c), token, cookieOptions(c));
}

/** The cookie lasts only as long as the link works. */
export function rememberInvitation(
  c: Context<AppEnv>,
  token: string,
  dinnerPublicId: string,
  expiresAt: number | null,
): void {
  const maxAge = expiresAt === null ? MAX_AGE : Math.min(MAX_AGE, Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)));
  setCookie(c, dinnerCookie(c, dinnerPublicId), token, cookieOptions(c, maxAge));
}

export function forgetPerson(c: Context<AppEnv>): void {
  deleteCookie(c, personalCookie(c), cookieOptions(c));
}

export function forgetInvitation(c: Context<AppEnv>, dinnerPublicId: string): void {
  deleteCookie(c, dinnerCookie(c, dinnerPublicId), cookieOptions(c));
}

async function personalSession(c: Context<AppEnv>) {
  const token = getCookie(c, personalCookie(c));
  const person = token ? await verifyPersonal(c, token) : null;
  return token && person ? { token, person } : null;
}

async function dinnerSession(c: Context<AppEnv>, dinnerPublicId: string) {
  const token = getCookie(c, dinnerCookie(c, dinnerPublicId));
  const found = token ? await verifyInvitation(c, token) : null;
  // The cookie's name says which dinner it's for, but only the signed token is trusted.
  return token && found?.dinnerPublicId === dinnerPublicId ? { token, found } : null;
}

/** Who this browser acts as on a dinner's pages: its one-dinner link if it has one, else the personal one. */
export async function identityOnDinner(c: Context<AppEnv>, dinnerPublicId: string): Promise<Person | null> {
  return (await dinnerSession(c, dinnerPublicId))?.found.person ?? c.get("actor")?.person ?? null;
}

/** On a dinner's pages, a one-dinner link for a different person wins over the personal one. */
export const loadActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  const personal = await personalSession(c);
  c.set("actor", personal && { person: personal.person, scope: "full" });
  if (personal) rememberPerson(c, personal.token);

  const dinnerPublicId = /^\/d\/([\w-]+)/.exec(c.req.path)?.[1];
  const invited = dinnerPublicId ? await dinnerSession(c, dinnerPublicId) : null;
  if (dinnerPublicId && invited && invited.found.person.id !== personal?.person.id) {
    const { person, invitation, dinnerStartsAt } = invited.found;
    c.set("actor", { person, scope: "dinner", dinnerId: invitation.dinner_id });
    rememberInvitation(c, invited.token, dinnerPublicId, invitationExpiresAt(dinnerStartsAt));
  }
  await next();
};
