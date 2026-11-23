import { applyD1Migrations, env, reset, SELF } from "cloudflare:test";
import { beforeEach } from "vitest";
import type { Bindings } from "../src/types";

export const bindings = env as unknown as Bindings & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
export const BASE = "https://dinner.test";

/** A browser with its own cookies, honoring cookie paths. */
export class Browser {
  cookies = new Map<string, { value: string; path: string }>();

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : BASE + path;
    const { pathname } = new URL(url);
    const headers = new Headers(init.headers);
    const sent = [...this.cookies]
      .filter(([, c]) => c.path === "/" || pathname === c.path || pathname.startsWith(`${c.path}/`))
      .map(([name, c]) => `${name}=${c.value}`);
    if (sent.length) headers.set("Cookie", sent.join("; "));
    const response = await SELF.fetch(url, { ...init, headers, redirect: "manual" });
    for (const line of response.headers.getSetCookie()) {
      const [, name, value] = /^([^=]+)=([^;]*)/.exec(line)!;
      if (/Max-Age=0/i.test(line)) this.cookies.delete(name!);
      else this.cookies.set(name!, { value: value!, path: /Path=([^;]+)/i.exec(line)![1]! });
    }
    return response;
  }

  async get(path: string) {
    const response = await this.request(path);
    return { status: response.status, headers: response.headers, body: await response.text() };
  }

  async post(path: string, fields: Record<string, string> = {}, origin: string | null = BASE) {
    const headers: Record<string, string> = origin ? { Origin: origin } : {};
    const response = await this.request(path, { method: "POST", body: new URLSearchParams(fields), headers });
    return { status: response.status, headers: response.headers, body: await response.text() };
  }
}

export const setup = { secret: "test-setup-secret", group: "Supper", name: "Sam", phone: "", timeZone: "America/Chicago" };

export async function links(browser: Browser, page: string, kind: "k" | "i"): Promise<string[]> {
  const { body } = await browser.get(page);
  return [...body.matchAll(new RegExp(`value="(${BASE}/${kind}/[^"]+)"`, "g"))].map((m) => m[1]!);
}

/** Sam organizes; Ana hosts; Bo is a member. Cards are in name order. */
export async function seed() {
  const sam = new Browser();
  await sam.post("/setup", setup);
  await sam.post("/members", { name: "Ana", phone: "512-555-0101" });
  await sam.post("/members", { name: "Bo", phone: "512-555-0102" });
  const [anaLink, boLink, samLink] = await links(sam, "/members", "k");
  const ana = new Browser();
  const bo = new Browser();
  await ana.get(anaLink!);
  await bo.get(boLink!);
  const created = await ana.post("/new", { title: "Soup night", startsAt: "2099-02-07T18:30", location: "Ana's", note: "" });
  return { sam, ana, bo, anaLink: anaLink!, boLink: boLink!, samLink: samLink!, dinner: created.headers.get("Location")! };
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
