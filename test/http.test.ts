import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, bindings, Browser, links, seed, setup } from "./helpers";

describe("setup", () => {
  it("needs the secret and locks afterwards", async () => {
    const browser = new Browser();
    expect((await browser.post("/setup", { ...setup, secret: "wrong" })).status).toBe(403);
    expect((await browser.post("/setup", setup)).headers.get("Location")).toBe("/members");
    expect((await browser.get("/members")).body).toContain("Sam (organizer)");
    expect((await new Browser().post("/setup", setup)).status).toBe(404);
    expect((await new Browser().get("/setup")).status).toBe(404);
  });
  it("lets only one of two simultaneous setups win", async () => {
    await Promise.all([new Browser().post("/setup", setup), new Browser().post("/setup", setup)]);
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>();
    expect(row!.n).toBe(1);
  });
});

describe("strangers", () => {
  it("see one identical page everywhere", async () => {
    const { dinner } = await seed();
    const pages = await Promise.all(
      ["/", "/new", "/members", "/setup", dinner, `${dinner}/send`, "/d/nope", "/k/bad", "/i/bad", "/zzz"].map((p) =>
        new Browser().get(p),
      ),
    );
    expect(new Set(pages.map((p) => p.body)).size).toBe(1);
    expect(pages.every((p) => p.status === 404)).toBe(true);
    expect(pages[0]!.body).toMatch(/^<!DOCTYPE html><html/);
    expect(pages[0]!.headers.get("Cache-Control")).toBe("no-store");
    expect(pages[0]!.headers.get("Referrer-Policy")).toBe("same-origin");
  });
  it("cannot post from another site, or without an origin", async () => {
    const { sam } = await seed();
    for (const origin of ["https://evil.test", "null", null]) {
      expect((await sam.post("/members", { name: "X", phone: "5125550109" }, origin)).status).toBe(403);
    }
  });
});

describe("personal links", () => {
  it("set a safe cookie and then open the group link", async () => {
    const { boLink, dinner } = await seed();
    const browser = new Browser();
    const opened = await browser.get(boLink);
    expect(opened.headers.get("Location")).toBe("/");
    expect(opened.headers.get("Set-Cookie")).toMatch(/HttpOnly/);
    expect(opened.headers.get("Set-Cookie")).toMatch(/Secure/);
    expect(opened.headers.get("Set-Cookie")).toMatch(/SameSite=Lax/);
    expect((await browser.get(dinner)).body).toContain("Soup night");
  });
  it("reject altered tokens", async () => {
    const { boLink } = await seed();
    const changed = boLink.slice(0, -1) + (boLink.endsWith("A") ? "B" : "A");
    expect((await new Browser().get(changed)).status).toBe(404);
    expect((await new Browser().get(boLink.replace(/\.1\./, ".2."))).status).toBe(404);
    expect((await new Browser().get(boLink.replace("/k/", "/i/"))).status).toBe(404);
  });
  it("stop old links, sessions and one-dinner links when replaced", async () => {
    const { sam, ana, bo, boLink, dinner } = await seed();
    const boDinnerLink = (await links(ana, `${dinner}/send`, "i"))[0]!;
    expect((await new Browser().get(boDinnerLink)).status).toBe(303);
    const id = new URL(boLink).pathname.slice(3).split(".")[0]!;
    await sam.post(`/members/${id}/reissue`);
    expect((await bo.get("/")).status).toBe(404);
    expect((await new Browser().get(boLink)).status).toBe(404);
    expect((await new Browser().get(boDinnerLink)).status).toBe(404);
  });
  it("keep organizers signed in when they replace their own", async () => {
    const { sam, samLink } = await seed();
    await sam.post(`/members/${new URL(samLink).pathname.slice(3).split(".")[0]}/reissue`);
    expect((await sam.get("/members")).status).toBe(200);
  });
  it("forget the person on request", async () => {
    const { bo } = await seed();
    await bo.post("/forget");
    expect((await bo.get("/")).status).toBe(404);
  });
});

describe("one-dinner links", () => {
  it("open that dinner only, as that person", async () => {
    const { ana, dinner } = await seed();
    const other = (await ana.post("/new", { title: "Tacos", startsAt: "2099-03-07T18:30", location: "", note: "", capacity: "" })).headers.get("Location")!;
    const browser = new Browser();
    expect((await browser.get((await links(ana, `${dinner}/send`, "i"))[0]!)).headers.get("Location")).toBe(dinner);
    expect((await browser.get(dinner)).body).toContain("You&#39;re Bo");
    for (const path of ["/", "/new", "/members", other, `${dinner}/send`]) {
      expect((await browser.get(path)).status).toBe(404);
    }
  });
  it("cannot be replayed as a cookie for another dinner", async () => {
    const { ana, dinner } = await seed();
    const other = (await ana.post("/new", { title: "Tacos", startsAt: "2099-03-07T18:30", location: "", note: "", capacity: "" })).headers.get("Location")!;
    const token = (await links(ana, `${dinner}/send`, "i"))[0]!.split("/i/")[1]!;
    const response = await SELF.fetch(BASE + other, { headers: { Cookie: `dc_dinner=${token}` } });
    expect(response.status).toBe(404);
  });
  it("sit on top of a personal session without replacing it", async () => {
    const { ana, bo, dinner } = await seed();
    const samLink = (await links(ana, `${dinner}/send`, "i"))[1]!;
    await bo.get(samLink);
    expect((await bo.get(dinner)).body).toContain("You&#39;re Sam");
    expect((await bo.get("/")).body).toContain("You&#39;re Bo");
    expect((await bo.get(`${dinner}/send`)).status).toBe(404);
    await bo.post(`${dinner}/forget`);
    expect((await bo.get(dinner)).body).toContain("You&#39;re Bo");
  });
  it("work for guests, who get nothing else", async () => {
    const { ana, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const guest = new Browser();
    await guest.get((await links(ana, `${dinner}/send`, "i"))[1]!);
    expect((await guest.get(dinner)).body).toContain("You&#39;re Cy");
    expect((await guest.get("/")).status).toBe(404);
  });
  it("can be replaced by the host", async () => {
    const { ana, dinner } = await seed();
    const link = (await links(ana, `${dinner}/send`, "i"))[0]!;
    await ana.post(`${dinner}/invitations/${link.split("/i/")[1]!.split(".")[0]}/reissue`);
    expect((await new Browser().get(link)).status).toBe(404);
  });
});

describe("privacy and roles", () => {
  it("shows phone numbers and links only to those who need them", async () => {
    const { ana, bo, sam, dinner } = await seed();
    expect((await bo.get(dinner)).body + (await bo.get("/")).body).not.toContain("555010");
    expect((await bo.get("/members")).status).toBe(403);
    expect((await bo.get(`${dinner}/send`)).status).toBe(404);
    const send = (await ana.get(`${dinner}/send`)).body;
    expect(send).toContain("+15125550102");
    expect(send).not.toContain("/k/");
    expect((await sam.get(`${dinner}/send`)).status).toBe(200);
  });
  it("limits member management to organizers", async () => {
    const { bo, samLink } = await seed();
    const id = new URL(samLink).pathname.slice(3).split(".")[0];
    for (const path of ["/members", `/members/${id}/reissue`, `/members/${id}/remove`, `/members/${id}/organizer`]) {
      expect((await bo.post(path, { name: "X", phone: "5125550109", on: "0" })).status).toBe(403);
    }
  });
  it("never removes the last organizer", async () => {
    const { sam, samLink } = await seed();
    const id = new URL(samLink).pathname.slice(3).split(".")[0];
    expect((await sam.post(`/members/${id}/remove`)).status).toBe(409);
    expect((await sam.post(`/members/${id}/organizer`, { on: "0" })).status).toBe(409);
  });
  it("says when a member is already gone, rather than blaming the organizer rule", async () => {
    const { sam, boLink } = await seed();
    const id = new URL(boLink).pathname.slice(3).split(".")[0];
    expect((await sam.post(`/members/${id}/remove`)).status).toBe(303);
    for (const response of [await sam.post(`/members/${id}/remove`), await sam.post(`/members/${id}/organizer`, { on: "1" })]) {
      expect(response.status).toBe(404);
      expect(response.body).toContain("isn&#39;t in the group any more");
    }
  });
  it("ends a removed member's access", async () => {
    const { sam, bo, boLink } = await seed();
    await sam.post(`/members/${new URL(boLink).pathname.slice(3).split(".")[0]}/remove`);
    expect((await bo.get("/")).status).toBe(404);
  });
  it("leaves opted-out members out of texts", async () => {
    const { ana, dinner } = await seed();
    await bindings.DB.prepare("UPDATE people SET texts_opt_out = 1 WHERE name = 'Bo'").run();
    expect((await ana.get(`${dinner}/send`)).body).not.toContain("+15125550102");
  });
});
