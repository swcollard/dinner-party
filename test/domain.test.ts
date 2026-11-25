import { describe, expect, it } from "vitest";
import { can } from "../src/auth/permissions";
import { normalizePhone, smsUri } from "../src/domain/messages";
import { isPast, localToUtc } from "../src/domain/time";
import type { Actor, Person } from "../src/types";

const person = (id: number, extra: Partial<Person> = {}): Person => ({
  id, public_id: `p${id}`, kind: "member", name: `P${id}`, phone: null,
  is_organizer: 0, texts_opt_out: 0, link_version: 1, removed_at: null, ...extra,
});

describe("time", () => {
  it("follows daylight saving", () => {
    expect(localToUtc("2027-02-06T18:30", "America/Chicago")).toBe(Date.parse("2027-02-07T00:30:00Z"));
    expect(localToUtc("2027-07-03T18:30", "America/Chicago")).toBe(Date.parse("2027-07-03T23:30:00Z"));
    expect(localToUtc("2027-03-14T03:30", "America/Chicago")).toBe(Date.parse("2027-03-14T08:30:00Z"));
    expect(localToUtc("2027-11-07T00:30", "America/Chicago")).toBe(Date.parse("2027-11-07T05:30:00Z"));
  });
  it("rejects impossible dates", () => {
    expect(localToUtc("2027-02-30T18:30", "America/Chicago")).toBeNull();
    expect(localToUtc("2027-02-06T25:30", "America/Chicago")).toBeNull();
    expect(localToUtc("soon", "America/Chicago")).toBeNull();
  });
  it("makes a dinner past only after its local day", () => {
    const start = Date.parse("2027-02-07T00:30:00Z");
    expect(isPast(start, "America/Chicago", Date.parse("2027-02-07T05:59:00Z"))).toBe(false);
    expect(isPast(start, "America/Chicago", Date.parse("2027-02-07T06:00:00Z"))).toBe(true);
  });
});

describe("messages", () => {
  it("normalizes phone numbers", () => {
    expect(normalizePhone("(512) 555-0100")).toBe("+15125550100");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0100")).toBeNull();
  });
  it("addresses groups per platform and encodes the body", () => {
    expect(smsUri(["+1", "+2"], "a&b", "iPhone")).toBe("sms:/open?addresses=+1,+2&body=a%26b");
    expect(smsUri(["+1", "+2"], "a&b", "Android")).toBe("sms:+1,+2?&body=a%26b");
  });
});

describe("permissions", () => {
  const dinner = { id: 7, host_id: 2, past: false };
  const member: Actor = { scope: "full", person: person(1) };
  const host: Actor = { scope: "full", person: person(2) };
  const organizer: Actor = { scope: "full", person: person(3, { is_organizer: 1 }) };
  const guest: Actor = { scope: "dinner", dinnerId: 7, person: person(4, { kind: "guest" }) };
  const everyone = [member, host, organizer, guest, null];
  const rows = [
    ["dinner.create", [true, true, true, false, false], false],
    ["dinner.chooseHost", [false, false, true, false, false], false],
    ["dinner.view", [true, true, true, true, false], true],
    ["dinner.edit", [false, true, true, false, false], true],
    ["poll.confirm", [false, true, true, false, false], true],
    ["poll.vote", [true, true, true, true, false], true],
    ["rsvp.own", [true, true, true, true, false], true],
    ["menu.edit", [false, true, true, false, false], true],
    ["dish.own", [true, true, true, true, false], true],
    ["dish.assign", [false, true, true, false, false], true],
    ["dish.any", [false, true, true, false, false], true],
    ["announce", [false, true, true, false, false], true],
    ["profile.own", [true, true, true, true, false], false],
    ["members.manage", [false, false, true, false, false], false],
    ["seasons.manage", [false, false, true, false, false], false],
  ] as const;

  it.each(rows)("%s", (action, expected, needsDinner) => {
    expect(everyone.map((actor) => can(actor, action, needsDinner ? dinner : undefined))).toEqual(expected);
  });
  it("makes past dinners read-only except to organizers", () => {
    const past = { ...dinner, past: true };
    expect(everyone.map((a) => can(a, "rsvp.own", past))).toEqual([false, false, true, false, false]);
    expect(everyone.map((a) => can(a, "dinner.view", past))).toEqual([true, true, true, true, false]);
  });
  it("never gives a one-dinner link host or organizer powers, or another dinner", () => {
    const viaLink: Actor = { scope: "dinner", dinnerId: 7, person: person(2, { is_organizer: 1 }) };
    expect(can(viaLink, "dinner.edit", dinner)).toBe(false);
    expect(can(viaLink, "members.manage")).toBe(false);
    expect(can(viaLink, "profile.own")).toBe(false);
    expect(can(viaLink, "dinner.view", { ...dinner, id: 8 })).toBe(false);
  });
});
