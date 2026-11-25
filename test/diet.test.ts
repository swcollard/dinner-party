import { describe, expect, it } from "vitest";
import { anonymousSummary, parseNeeds } from "../src/domain/diet";
import { BASE, bindings, Browser, links, seed } from "./helpers";

const section = (body: string) => /<h2>Dietary needs<\/h2>.*?<\/section>/s.exec(body)?.[0] ?? "";

describe("needs", () => {
  it("keeps known choices and trimmed text only", () => {
    expect(parseNeeds(["allergen:eggs", "diet:eggs", "diet:vegan", "x"], "  no cilantro ")).toEqual([
      { kind: "allergen", label: "eggs" },
      { kind: "diet", label: "vegan" },
      { kind: "other", label: "no cilantro" },
    ]);
  });
  it("summarizes without names", () => {
    expect(anonymousSummary([[{ kind: "diet", label: "vegan" }], [{ kind: "diet", label: "vegan" }, { kind: "allergen", label: "soy" }]]))
      .toEqual(["vegan (2 people)", "soy allergy"]);
  });
});

describe("profile", () => {
  it("saves several needs and carries them to dinners once coming", async () => {
    const { bo, sam, dinner } = await seed();
    const body = new URLSearchParams([
      ["name", "Bo"], ["phone", "5125550102"], ["need", "allergen:peanuts"], ["need", "diet:vegetarian"], ["other", ""],
    ]);
    expect((await bo.request("/profile", { method: "POST", body, headers: { Origin: BASE } })).status).toBe(303);
    expect(section((await sam.get(dinner)).body)).toBe("");
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    expect(section((await sam.get(dinner)).body)).toContain("<strong>Bo:</strong> peanuts allergy, vegetarian");
  });
  it("updates contact details and the text opt-out", async () => {
    const { bo } = await seed();
    await bo.post("/profile", { name: "Bob", phone: "", textsOptOut: "on", other: "" });
    expect(await bindings.DB.prepare("SELECT name, phone, texts_opt_out FROM people WHERE name = 'Bob'").first())
      .toEqual({ name: "Bob", phone: null, texts_opt_out: 1 });
    expect((await bo.post("/profile", { name: "Bob", phone: "12", other: "" })).status).toBe(400);
  });
  it("clears needs", async () => {
    const { bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/diet`, { need: "diet:vegan", other: "" });
    expect(section((await bo.get(dinner)).body)).toContain("vegan");
    await bo.post(`${dinner}/diet`, { other: "" });
    expect(section((await bo.get(dinner)).body)).toBe("");
  });
  it("can't be changed through a member's one-dinner link", async () => {
    const { ana, bo, dinner } = await seed();
    await bo.post(`${dinner}/diet`, { need: "diet:vegan", other: "" });
    const browser = new Browser();
    await browser.get((await links(ana, `${dinner}/send`, "i"))[0]!);
    expect((await browser.get("/profile")).status).toBe(404);
    expect((await browser.post("/profile", { name: "X", phone: "", other: "" })).status).toBe(404);
    expect((await browser.get(`${dinner}/diet`)).status).toBe(404);
    expect((await browser.post(`${dinner}/diet`, { other: "" })).status).toBe(404);
    expect((await browser.get(dinner)).body).toContain("open your personal link");
    expect((await browser.post(`${dinner}/rsvp`, { rsvp: "yes" })).status).toBe(303);
    expect(section((await bo.get(dinner)).body)).toContain("vegan");
  });
});

describe("the waitlist", () => {
  it("is labelled for members and left out for guests", async () => {
    const { ana, bo, dinner } = await seed();
    await bindings.DB.prepare("UPDATE dinners SET capacity = 1").run();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/diet`, { need: "allergen:soy", other: "" });
    expect(section((await ana.get(dinner)).body)).toContain("<strong>Bo (waitlist):</strong> soy allergy");
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const guest = new Browser();
    await guest.get((await links(ana, `${dinner}/send`, "i"))[1]!);
    expect(section((await guest.get(dinner)).body)).toBe("");
  });
});

describe("guests and plus-ones", () => {
  it("shows names to members but not to guests", async () => {
    const { ana, bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/diet`, { need: "allergen:soy", other: "" });
    await ana.post(`${dinner}/guests`, { name: "Cy", phone: "" });
    const guest = new Browser();
    await guest.get((await links(ana, `${dinner}/send`, "i"))[1]!);
    const seen = section((await guest.get(dinner)).body);
    expect(seen).toContain("soy allergy");
    expect(seen).not.toContain("Bo");

    await guest.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await guest.post(`${dinner}/diet`, { need: "diet:halal", other: "" });
    expect(section((await bo.get(dinner)).body)).toContain("<strong>Cy:</strong> halal");
  });
  it("captures a plus-one's needs, and editing keeps their place", async () => {
    const { bo, dinner } = await seed();
    await bo.post(`${dinner}/rsvp`, { rsvp: "yes" });
    await bo.post(`${dinner}/plus-ones`, { name: "Dot", need: "allergen:fish", other: "" });
    const { body } = await bo.get(dinner);
    expect(section(body)).toContain("<strong>Dot (with Bo):</strong> fish allergy");
    const before = await bindings.DB.prepare("SELECT id, queued_at FROM attendees WHERE plus_one_name = 'Dot'").first();
    await bo.post(/action="([^"]+\/edit)"/.exec(body)![1]!, { name: "Dottie", other: "no olives" });
    expect(section((await bo.get(dinner)).body)).toContain("<strong>Dottie (with Bo):</strong> no olives");
    expect(await bindings.DB.prepare("SELECT id, queued_at FROM attendees WHERE plus_one_name = 'Dottie'").first()).toEqual(before);
  });
});
