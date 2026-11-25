import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../types";
import { ErrorPage, NeutralPage } from "../views/layout";

export function neutral(c: Context<AppEnv>) {
  return c.html(<NeutralPage />, 404);
}

export function problem(c: Context<AppEnv>, message: string, back: string, status: 400 | 403 | 404 | 409 = 400) {
  return c.html(<ErrorPage actor={c.get("actor")} message={message} back={back} />, status);
}

export async function readForm<T extends z.ZodType>(c: Context<AppEnv>, schema: T) {
  return schema.safeParse(await c.req.parseBody());
}

export function absoluteUrl(c: Context<AppEnv>, path: string): string {
  return new URL(path, c.env.PUBLIC_BASE_URL).href;
}

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  // Not no-referrer: that makes browsers send "Origin: null" on our own form posts.
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
};

/** Compares hosts rather than origins, because a TLS proxy can change the scheme we see. */
export const sameOriginPosts: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const origin = c.req.header("Origin") ?? "";
  const allowed = [c.req.url, c.env.PUBLIC_BASE_URL].map((url) => new URL(url).host);
  if (!URL.canParse(origin) || !allowed.includes(new URL(origin).host)) {
    return c.text("Cross-site request blocked", 403);
  }
  return next();
};
