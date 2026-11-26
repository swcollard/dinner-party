import { describe, expect, it } from "vitest";
import app from "../src/index";
import { BASE, bindings, Browser, links, seed, setup } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const tokenOf = (link: string) => new URL(link).pathname;

describe("setup secret", () => {
  it("keeps setup locked while the secret is short", async () => {
    const env = { ...bindings, SETUP_SECRET: "short" };
    expect((await app.request(`${BASE}/setup`, {}, env)).status).toBe(503);
    const body = new URLSearchParams({ ...setup, secret: "short" });
    const posted = await app.request(`${BASE}/setup`, { method: "POST", body, headers: { Origin: BASE } }, env);
    expect(posted.status).toBe(503);
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM people").first("n")).toBe(0);
  });
});

describe("one-dinner links", () => {
  it("stop working a week after the dinner, and their cookie expires with them", async () => {
    const { ana, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const link = (await links(ana, `${dinner}/send`, "i"))[1]!;
    const setStartsAt = (daysAgo: number) =>
      bindings.DB.prepare("UPDATE dinners SET starts_at = ?").bind(Date.now() - daysAgo * DAY).run();

    await setStartsAt(6);
    const guest = new Browser();
    const opened = await guest.request(link);
    expect(opened.status).toBe(303);
    const maxAge = Number(/Max-Age=(\d+)/.exec(opened.headers.get("Set-Cookie")!)![1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(DAY / 1000);
    expect((await guest.get(dinner)).body).toContain("You&#39;re Cy");

    await setStartsAt(8);
    expect((await guest.get(dinner)).status).toBe(404);
    expect((await new Browser().get(link)).status).toBe(404);
  });
  it("keep working for dinners without a date", async () => {
    const { ana, dinner } = await seed();
    await bindings.DB.prepare("UPDATE dinners SET starts_at = NULL, status = 'planning'").run();
    expect((await new Browser().get((await links(ana, `${dinner}/send`, "i"))[0]!)).status).toBe(303);
  });
});

describe("switching person", () => {
  it("asks before a personal link replaces someone else", async () => {
    const { bo, samLink } = await seed();
    const asked = await bo.get(samLink);
    expect(asked.status).toBe(200);
    expect(asked.body).toContain("Continue as Sam?");
    expect((await bo.get("/")).body).toContain("You&#39;re Bo");
    expect((await bo.post(tokenOf(samLink))).status).toBe(303);
    expect((await bo.get("/")).body).toContain("You&#39;re Sam");
  });
  it("needs a same-site POST to switch", async () => {
    const { bo, samLink } = await seed();
    expect((await bo.post(tokenOf(samLink), {}, "https://evil.test")).status).toBe(403);
    expect((await bo.get("/")).body).toContain("You&#39;re Bo");
  });
  it("asks before one guest's link replaces another's on that dinner", async () => {
    const { ana, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    await ana.post(`${dinner}/guests`, { name: "Di", phone: "" });
    const [, cyLink, diLink] = await links(ana, `${dinner}/send`, "i");
    const cy = new Browser();
    expect((await cy.get(cyLink!)).status).toBe(303);
    expect((await cy.get(diLink!)).body).toContain("Continue as Di?");
    expect((await cy.get(dinner)).body).toContain("You&#39;re Cy");
  });
  it("doesn't ask when the link is your own", async () => {
    const { bo, boLink, ana, dinner } = await seed();
    expect((await bo.get(boLink)).status).toBe(303);
    expect((await bo.get((await links(ana, `${dinner}/send`, "i"))[0]!)).status).toBe(303);
  });
});

describe("cookies", () => {
  it("use the __Host- prefix over HTTPS", async () => {
    const { boLink } = await seed();
    const response = await new Browser().request(boLink);
    expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-dc=.*Path=\/.*Secure/);
  });
  it("fall back to plain names over HTTP, where the prefix can't work", async () => {
    const { boLink } = await seed();
    const env = { ...bindings, PUBLIC_BASE_URL: "http://localhost:8787" };
    const response = await app.request(`http://localhost:8787${tokenOf(boLink)}`, {}, env);
    expect(response.headers.get("Set-Cookie")).toMatch(/^dc=/);
  });
});

describe("removing people", () => {
  it("deletes a removed member's phone number and dietary restrictions, and their plus-ones' too", async () => {
    const { sam, bo, boLink, dinner } = await seed();
    await bo.post(`${dinner}/diet`, { need: "diet:vegan", other: "" });
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/plus-ones`, { name: "Dot", need: "allergen:fish", other: "" });
    await sam.post(`/members/${tokenOf(boLink).slice(3).split(".")[0]}/remove`);
    expect(await bindings.DB.prepare("SELECT phone, removed_at IS NOT NULL AS removed FROM people WHERE name = 'Bo'").first())
      .toEqual({ phone: null, removed: 1 });
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM dietary_needs").first("n")).toBe(0);
    expect(await bindings.DB.prepare("SELECT diet FROM attendees WHERE plus_one_name = 'Dot'").first("diet")).toBe("[]");
  });
  it("leaves everything alone when the last organizer can't be removed", async () => {
    const { sam, samLink } = await seed();
    await sam.post("/profile", { name: "Sam", phone: "5125550100", need: "diet:vegan", other: "" });
    expect((await sam.post(`/members/${tokenOf(samLink).slice(3).split(".")[0]}/remove`)).status).toBe(409);
    expect(await bindings.DB.prepare("SELECT phone FROM people WHERE name = 'Sam'").first("phone")).toBe("+15125550100");
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM dietary_needs").first("n")).toBe(1);
  });
  it("lets a host take a guest off a dinner, ending their link and deleting their details", async () => {
    const { ana, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "5125550199" });
    const cyLink = (await links(ana, `${dinner}/send`, "i"))[1]!;
    const cy = new Browser();
    await cy.get(cyLink);
    await cy.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await cy.post(`${dinner}/diet`, { need: "diet:halal", other: "" });

    const invitation = tokenOf(cyLink).slice(3).split(".")[0];
    expect((await ana.post(`${dinner}/guests/${invitation}/remove`)).status).toBe(303);
    expect((await cy.get(dinner)).status).toBe(404);
    expect((await new Browser().get(cyLink)).status).toBe(404);
    expect((await ana.get(dinner)).body).not.toContain("Cy");
    expect(await bindings.DB.prepare("SELECT phone FROM people WHERE name = 'Cy'").first("phone")).toBeNull();
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM dietary_needs").first("n")).toBe(0);
    expect((await ana.post(`${dinner}/guests/${invitation}/remove`)).status).toBe(404);
  });
  it("only removes guests, and only for the host", async () => {
    const { ana, bo, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const [boInvite, cyInvite] = (await links(ana, `${dinner}/send`, "i")).map((l) => tokenOf(l).slice(3).split(".")[0]);
    expect((await bo.post(`${dinner}/guests/${cyInvite}/remove`)).status).toBe(404);
    expect((await ana.post(`${dinner}/guests/${boInvite}/remove`)).status).toBe(404);
    expect((await ana.get(dinner)).body).toContain("Bo, Cy");
  });
});

describe("member names", () => {
  it("can't repeat a current member's name, ignoring case and spacing", async () => {
    const { sam, bo } = await seed();
    const added = await sam.post("/members", { name: "  ana ", phone: "5125550103" });
    expect(added.status).toBe(409);
    expect(added.body).toContain("already goes by that name");
    expect((await bo.post("/profile", { name: "ANA", phone: "", other: "" })).status).toBe(409);
    expect((await bo.post("/profile", { name: "Bo   B.", phone: "", other: "" })).status).toBe(303);
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE name = 'Bo B.'").first("n")).toBe(1);
  });
  it("frees a removed member's name", async () => {
    const { sam, boLink } = await seed();
    await sam.post(`/members/${tokenOf(boLink).slice(3).split(".")[0]}/remove`);
    expect((await sam.post("/members", { name: "Bo", phone: "5125550104" })).status).toBe(303);
  });
});
