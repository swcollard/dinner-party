import { describe, expect, it } from "vitest";
import { localToUtc, utcToLocal } from "../src/domain/time";
import { bindings, personId, seed } from "./helpers";

const form = { title: "Soup night", startsAt: "2099-02-07T18:30", location: "Ana's", note: "", capacity: "" };
const row = () =>
  bindings.DB.prepare("SELECT * FROM dinners").first<{ title: string; capacity: number | null; rsvp_closed: number; status: string }>();

describe("editing", () => {
  it("round-trips local times", () => {
    for (const local of ["2027-02-06T18:30", "2027-07-03T00:15"]) {
      expect(utcToLocal(localToUtc(local, "America/Chicago")!, "America/Chicago")).toBe(local);
    }
  });
  it("shows current values and saves changes", async () => {
    const { ana, dinner } = await seed();
    expect((await ana.get(`${dinner}/edit`)).body).toContain('value="2099-02-07T18:30"');
    const saved = await ana.post(`${dinner}/edit`, { ...form, title: "Stew", capacity: "8", rsvpClosed: "on" });
    expect(saved.headers.get("Location")).toBe(dinner);
    expect(await row()).toMatchObject({ title: "Stew", capacity: 8, rsvp_closed: 1 });
    await ana.post(`${dinner}/edit`, form);
    expect(await row()).toMatchObject({ capacity: null, rsvp_closed: 0 });
  });
  it("belongs to the host and organizer", async () => {
    const { sam, bo, dinner } = await seed();
    for (const action of ["edit", "cancel", "restore"]) {
      expect((await bo.post(`${dinner}/${action}`, form)).status).toBe(404);
    }
    expect((await bo.get(`${dinner}/edit`)).status).toBe(404);
    expect((await sam.post(`${dinner}/edit`, form)).status).toBe(303);
  });
  it("rejects bad seats and dates", async () => {
    const { ana, dinner } = await seed();
    for (const bad of [{ capacity: "0" }, { capacity: "2.5" }, { capacity: "lots" }, { startsAt: "" }, { title: " " }]) {
      expect((await ana.post(`${dinner}/edit`, { ...form, ...bad })).status).toBe(400);
    }
  });
  it("stops hosts choosing a past day, which would lock them out", async () => {
    const { sam, ana, dinner } = await seed();
    const past = { ...form, startsAt: "2020-02-07T18:30" };
    expect((await ana.post("/new", { ...past, host: await personId("Ana") })).status).toBe(400);
    expect((await ana.post(`${dinner}/edit`, past)).status).toBe(400);
    expect((await sam.post(`${dinner}/edit`, past)).status).toBe(303);
  });
  it("asks before taking seats away", async () => {
    const { ana, bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    const asked = await ana.post(`${dinner}/edit`, { ...form, capacity: "1", note: "Bring <forks>" });
    expect(asked.body).toContain("Move 1 to the waitlist?");
    expect(asked.body).toContain("Bring &lt;forks&gt;");
    expect((await row())!.capacity).toBeNull();
    await ana.post(`${dinner}/edit`, { ...form, capacity: "1", confirmed: "1" });
    expect((await bo.get(dinner)).body).toContain("number 1 on the waitlist");
    await ana.post(`${dinner}/edit`, { ...form, capacity: "2" });
    expect((await bo.get(dinner)).body).toContain("You&#39;re coming.");
  });
  it("cancels and restores without losing replies", async () => {
    const { ana, bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await ana.post(`${dinner}/cancel`);
    expect((await bo.get(dinner)).body).toContain("This dinner is cancelled.");
    expect((await ana.get(`${dinner}/edit`)).body).toContain("This dinner is cancelled.");
    expect((await bo.get("/")).body).toContain("Cancelled");
    await ana.post(`${dinner}/restore`);
    expect((await bo.get(dinner)).body).toContain("You&#39;re coming.");
  });
});

describe("choosing a host", () => {
  it("defaults to you and lists the group", async () => {
    const { bo } = await seed();
    const { body } = await bo.get("/new");
    expect(body).toMatch(/<option[^>]*selected[^>]*>Bo \(you\)<\/option>/);
    expect(body).toContain(">Ana</option>");
  });
  it("gives the chosen member the dinner and a seat", async () => {
    const { ana, bo } = await seed();
    const path = (await bo.post("/new", { ...form, host: await personId("Ana") })).headers.get("Location")!;
    const { body } = await bo.get(path);
    expect(body).toContain("Host: Ana");
    expect(body).toContain("You haven&#39;t replied yet.");
    expect((await ana.get(`${path}/edit`)).status).toBe(200);
    expect((await bo.get(`${path}/edit`)).status).toBe(404);
  });
  it("must be a current member, not a guest", async () => {
    const { ana, sam, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const bo = await personId("Bo");
    await sam.post(`/members/${bo}/remove`);
    for (const host of [await personId("Cy"), bo, "nobody"]) {
      const response = await ana.post("/new", { ...form, host });
      expect(response.status).toBe(400);
      expect(response.body).toContain("Choose a host");
    }
  });
});
