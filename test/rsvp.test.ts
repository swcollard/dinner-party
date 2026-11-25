import { describe, expect, it } from "vitest";
import { setRsvp } from "../src/db/rsvps";
import { assignSeats } from "../src/domain/seats";
import { localDay, localToUtc } from "../src/domain/time";
import type { Invitation } from "../src/types";
import { bindings, Browser, links, seed } from "./helpers";

const seat = (id: number, queued_at: number, person_id: number | null = id) => ({ id, invitation_id: id, person_id, queued_at });

async function setCapacity(n: number) {
  await bindings.DB.prepare("UPDATE dinners SET capacity = ?").bind(n).run();
}
/** Text of one "Who's coming" line, e.g. "Ana, Bo". */
const line = (body: string, title: string) => new RegExp(`<strong>${title} \\(\\d+\\):</strong> ([^<]*)`).exec(body)?.[1];

describe("assignSeats", () => {
  it("seats in order up to capacity", () => {
    const { seated, waitlist } = assignSeats([seat(3, 30), seat(1, 10), seat(2, 20)], 2);
    expect(seated.map((s) => s.id)).toEqual([1, 2]);
    expect(waitlist.map((s) => s.id)).toEqual([3]);
  });
  it("puts people ahead of plus-ones on a tie, and has no limit without capacity", () => {
    const { seated, waitlist } = assignSeats([seat(1, 10, null), seat(2, 10)], null);
    expect(seated.map((s) => s.id)).toEqual([2, 1]);
    expect(waitlist).toEqual([]);
  });
});

describe("rsvp", () => {
  it("starts with the host coming and everyone else unanswered", async () => {
    const { bo, dinner } = await seed();
    const { body } = await bo.get(dinner);
    expect(line(body, "Coming")).toBe("Ana");
    expect(line(body, "No reply")).toBe("Bo, Sam");
  });
  it("can be changed freely", async () => {
    const { bo, dinner } = await seed();
    for (const [rsvp, title] of [["yes", "Coming"], ["maybe", "Maybe"], ["no", "Not coming"], ["yes", "Coming"]]) {
      expect((await bo.post(`${dinner}/rsvp`, { rsvp: rsvp! })).status).toBe(303);
      expect(line((await bo.get(dinner)).body, title!)).toContain("Bo");
    }
    expect((await bo.post(`${dinner}/rsvp`, { rsvp: "perhaps" })).status).toBe(400);
  });
  it("waitlists past capacity and promotes when someone drops", async () => {
    const { sam, bo, dinner } = await seed();
    await setCapacity(2);
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await sam.post(`${dinner}/rsvp`, { rsvp: "yes" });
    expect((await sam.get(dinner)).body).toContain("number 1 on the waitlist");
    await bo.post(`${dinner}/rsvp`, { rsvp: "no" });
    expect(line((await sam.get(dinner)).body, "Coming")).toBe("Ana, Sam");
  });
  it("keeps the place in line on a repeated yes but not after a no", async () => {
    await seed();
    const invitation = (await bindings.DB.prepare(
      "SELECT i.* FROM invitations i JOIN people p ON p.id = i.person_id WHERE p.name = 'Bo'",
    ).first<Invitation>())!;
    const queuedAt = async () =>
      (await bindings.DB.prepare("SELECT queued_at FROM attendees WHERE invitation_id = ?").bind(invitation.id).first<{ queued_at: number }>())!.queued_at;
    await setRsvp(bindings.DB, invitation, "yes", 100);
    await setRsvp(bindings.DB, invitation, "yes", 200);
    expect(await queuedAt()).toBe(100);
    await setRsvp(bindings.DB, invitation, "no", 300);
    await setRsvp(bindings.DB, invitation, "yes", 400);
    expect(await queuedAt()).toBe(400);
  });
  it("is refused once closed, cancelled or past", async () => {
    const { bo, dinner } = await seed();
    const reply = async () => (await bo.post(`${dinner}/rsvp`, { rsvp: "yes" })).status;
    await bindings.DB.prepare("UPDATE dinners SET rsvp_closed = 1").run();
    expect(await reply()).toBe(409);
    await bindings.DB.prepare("UPDATE dinners SET rsvp_closed = 0, status = 'cancelled'").run();
    expect(await reply()).toBe(409);
    await bindings.DB.prepare("UPDATE dinners SET status = 'confirmed', starts_at = 0").run();
    expect(await reply()).toBe(404);
  });
  it("keeps the host coming, but still lets them bring someone", async () => {
    const { ana, bo, dinner } = await seed();
    for (const rsvp of ["no", "maybe"]) expect((await ana.post(`${dinner}/rsvp`, { rsvp })).status).toBe(409);
    expect((await ana.post(`${dinner}/plus-ones`, { name: "Cy" })).status).toBe(303);
    const { body } = await ana.get(dinner);
    expect(body).toContain("You&#39;re hosting");
    expect(body).not.toContain('name="rsvp"');
    expect(line(body, "Coming")).toBe("Ana, Cy (with Ana)");
    expect((await bo.get(dinner)).body).toContain('name="rsvp"');
  });
  it("lets a host without a reply say yes", async () => {
    const { ana, dinner } = await seed();
    await bindings.DB.batch([
      bindings.DB.prepare("UPDATE invitations SET rsvp = NULL"),
      bindings.DB.prepare("DELETE FROM attendees"),
    ]);
    const { body } = await ana.get(dinner);
    expect(body).toContain('value="yes"');
    expect(body).not.toContain('value="no"');
    await ana.post(`${dinner}/rsvp`, { rsvp: "yes" });
    expect(line((await ana.get(dinner)).body, "Coming")).toBe("Ana");
  });
  it("invites a new member to today's and cancelled dinners, but not past ones", async () => {
    const { sam } = await seed();
    const invited = async (name: string) =>
      (await bindings.DB.prepare("SELECT i.public_id FROM invitations i JOIN people p ON p.id = i.person_id WHERE p.name = ?")
        .bind(name).all<{ public_id: string }>()).results;
    // Already started, but the local day isn't over.
    const midnight = localToUtc(`${localDay(Date.now(), "America/Chicago")}T00:00`, "America/Chicago")!;
    await bindings.DB.prepare("UPDATE dinners SET starts_at = ?").bind(midnight).run();
    await sam.post("/members", { name: "Dee", phone: "5125550104" });
    expect((await invited("Dee"))[0]!.public_id).toMatch(/^[\w-]{22}$/);
    await bindings.DB.prepare("UPDATE dinners SET status = 'cancelled'").run();
    await sam.post("/members", { name: "Eve", phone: "5125550105" });
    expect(await invited("Eve")).toHaveLength(1);
    await bindings.DB.prepare("UPDATE dinners SET starts_at = 0, status = 'confirmed'").run();
    await sam.post("/members", { name: "Fay", phone: "5125550106" });
    expect(await invited("Fay")).toHaveLength(0);
  });
  it("is refused to strangers", async () => {
    const { dinner } = await seed();
    expect((await new Browser().post(`${dinner}/rsvp`, { rsvp: "yes" })).status).toBe(404);
  });
  it("includes members added later and drops removed ones", async () => {
    const { sam, bo, boLink, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await sam.post("/members", { name: "Dee", phone: "5125550104" });
    await sam.post(`/members/${new URL(boLink).pathname.slice(3).split(".")[0]}/remove`);
    const { body } = await sam.get(dinner);
    expect(line(body, "Coming")).toBe("Ana");
    expect(line(body, "No reply")).toBe("Dee, Sam");
  });
  it("gives a late member a working one-dinner link", async () => {
    const { sam, ana, dinner } = await seed();
    await sam.post("/members", { name: "Dee", phone: "5125550104" });
    const browser = new Browser();
    expect((await browser.get((await links(ana, `${dinner}/send`, "i"))[1]!)).status).toBe(303);
    expect((await browser.get(dinner)).body).toContain("You&#39;re Dee");
  });
});

describe("plus-ones", () => {
  it("need a yes, count as seats, and can be waitlisted separately", async () => {
    const { bo, dinner } = await seed();
    await setCapacity(2);
    expect((await bo.post(`${dinner}/plus-ones`, { name: "Cy" })).status).toBe(409);
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    expect((await bo.post(`${dinner}/plus-ones`, { name: "Cy" })).status).toBe(303);
    const { body } = await bo.get(dinner);
    expect(line(body, "Coming")).toBe("Ana, Bo");
    expect(line(body, "Waitlist")).toBe("Cy (with Bo)");
  });
  it("leave with their member and return with them", async () => {
    const { bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/plus-ones`, { name: "Cy" });
    await bo.post(`${dinner}/rsvp`, { rsvp: "no" });
    expect((await bo.get(dinner)).body).not.toContain("Cy");
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    expect(line((await bo.get(dinner)).body, "Coming")).toBe("Ana, Bo, Cy (with Bo)");
  });
  it("can be removed only by the person bringing them", async () => {
    const { sam, bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/plus-ones`, { name: "Cy" });
    const path = /action="([^"]+plus-ones\/\d+\/remove)"/.exec((await bo.get(dinner)).body)![1]!;
    await sam.post(path);
    expect((await bo.get(dinner)).body).toContain("Cy");
    await bo.post(path);
    expect((await bo.get(dinner)).body).not.toContain("Cy");
  });
  it("aren't available to guests", async () => {
    const { ana, dinner } = await seed();
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const guest = new Browser();
    await guest.get((await links(ana, `${dinner}/send`, "i"))[1]!);
    expect((await guest.post(`${dinner}/rsvp`, { rsvp: "yes" })).status).toBe(303);
    expect((await guest.post(`${dinner}/plus-ones`, { name: "Dot" })).status).toBe(403);
  });
});
