import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Page, expect, test } from "@playwright/test";

let organizer: Page;
let anaLink: string;
let boLink: string;
let dinnerUrl: string;

async function newPerson(browser: Browser, link: string, options = {}) {
  const page = await (await browser.newContext(options)).newPage();
  await page.goto(link);
  return page;
}

async function expectGoodPage(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${page.url()} ${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function linkFor(page: Page, name: string) {
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
  return card.locator("input[readonly]").inputValue();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  organizer = await (await browser.newContext()).newPage();
  await organizer.goto("/setup");
  await expectGoodPage(organizer);
  await organizer.getByLabel("Setup secret").fill("e2e-setup-secret-at-least-32-characters");
  await organizer.getByLabel("Group name").fill("Supper Club");
  await organizer.getByLabel("Your name").fill("Sam");
  await organizer.getByRole("button", { name: "Create group" }).click();
  for (const [name, phone] of [["Ana", "5125550101"], ["Bo", "5125550102"]]) {
    await organizer.getByLabel("Name", { exact: true }).fill(name!);
    await organizer.getByLabel("Phone").fill(phone!);
    await organizer.getByRole("button", { name: "Add member" }).click();
  }
  anaLink = await linkFor(organizer, "Ana");
  boLink = await linkFor(organizer, "Bo");
});

test("a host sets up a dinner and sends it", async ({ browser }) => {
  const ana = await newPerson(browser, anaLink);
  await ana.getByRole("link", { name: "New dinner" }).click();
  await expectGoodPage(ana);
  await expect(ana.getByLabel("Host").locator("option")).toHaveText(["Ana (you)"]);
  await expect(ana.getByLabel("Host")).toBeDisabled();
  await ana.getByLabel("Title").fill("Soup night");
  await ana.getByLabel("Address").fill("12 Oak St, Austin");
  await ana.getByLabel("Date and time").fill("2099-02-07T18:30");
  await ana.getByLabel(/Seats/).fill("3");
  await ana.getByRole("button", { name: "Create dinner" }).click();
  dinnerUrl = ana.url();
  await expect(ana.getByText("Saturday, Feb 7")).toBeVisible();
  await expect(ana.getByRole("link", { name: "12 Oak St, Austin" })).toBeVisible();
  await ana.getByRole("link", { name: "Edit dinner" }).click();
  await expectGoodPage(ana);
  await ana.goto(`${dinnerUrl}/send`);
  await expectGoodPage(ana);
});

test("a member taps the invite, says yes and adds a plus-one", async ({ browser }) => {
  const bo = await newPerson(browser, boLink);
  await bo.goto(dinnerUrl);
  await bo.getByRole("button", { name: "Yes" }).click();
  await expect(bo.getByRole("status")).toHaveText("You're coming.");
  await bo.getByText("Bringing someone?").click();
  await bo.getByLabel("Their name").last().fill("Cy");
  await bo.getByText("Dietary restrictions (optional)").click();
  await bo.locator("details form").last().getByLabel("peanut allergy").check();
  await bo.getByRole("button", { name: "Add plus-one" }).click();
  await expect(bo.getByText("Cy (with Bo): peanut allergy")).toBeVisible();
  await expect(bo.getByText("3 coming of 3 seats")).toBeVisible();
  await expectGoodPage(bo);
});

test("calendar file downloads", async ({ browser }) => {
  const bo = await newPerson(browser, boLink);
  await bo.goto(dinnerUrl);
  const download = bo.waitForEvent("download");
  await bo.getByRole("link", { name: "Add to calendar" }).click();
  expect((await download).suggestedFilename()).toBe("dinner.ics");
});

test("the waitlist and RSVP work without JavaScript", async ({ browser }) => {
  const sam = await newPerson(browser, await linkFor(organizer, "Sam"), { javaScriptEnabled: false });
  await sam.goto(dinnerUrl);
  await sam.getByRole("button", { name: "Yes" }).click();
  await expect(sam.getByRole("status")).toHaveText("You're number 1 on the waitlist.");
});

test("profile and members pages are accessible", async ({ browser }) => {
  const bo = await newPerson(browser, boLink);
  await expectGoodPage(bo);
  await bo.getByRole("link", { name: "Profile" }).click();
  await expectGoodPage(bo);
  await expectGoodPage(organizer);
  await bo.goto(`${dinnerUrl}/diet`);
  await expectGoodPage(bo);
});

test("other dietary needs appear on demand, save and clear", async ({ browser }) => {
  const bo = await newPerson(browser, boLink, { javaScriptEnabled: false });
  for (const page of ["/profile", `${dinnerUrl}/diet`]) {
    await bo.goto(page);
    const box = bo.getByRole("checkbox", { name: "Other" });
    const text = bo.getByLabel("Other dietary restrictions");
    await expect(text).toBeHidden();
    await box.check();
    await text.fill("no cilantro");
    await bo.getByRole("button", { name: "Save" }).click();
    await bo.goto(page);
    await expect(box).toBeChecked();
    await expect(text).toHaveValue("no cilantro");
    await box.uncheck();
    await bo.getByRole("button", { name: "Save" }).click();
    await bo.goto(page);
    await expect(box).not.toBeChecked();
  }
  // Scan with the text field showing.
  const ana = await newPerson(browser, anaLink);
  await ana.goto("/profile");
  await ana.getByRole("checkbox", { name: "Other" }).check();
  await expectGoodPage(ana);
});

test("typing an other need ticks its box where the field can't be hidden", async ({ browser }) => {
  const bo = await newPerson(browser, boLink);
  await bo.goto("/profile");
  const text = bo.getByLabel("Other dietary restrictions");
  await text.evaluate((input) => input.style.setProperty("display", "block"));
  await text.fill("no cilantro");
  await expect(bo.getByRole("checkbox", { name: "Other" })).toBeChecked();
});

test("an organizer can choose another host", async () => {
  await organizer.goto("/new");
  await expectGoodPage(organizer);
  await organizer.getByLabel("Host").selectOption("Ana");
  await organizer.getByLabel("Title").fill("Tacos");
  await organizer.getByLabel("Date and time").fill("2099-03-07T18:30");
  await organizer.getByRole("button", { name: "Create dinner" }).click();
  await expect(organizer.getByText("Host: Ana")).toBeVisible();
  await organizer.goto("/members");
});

test("pages are accessible in dark mode", async ({ browser }) => {
  const ana = await newPerson(browser, anaLink, { colorScheme: "dark" });
  await ana.goto(dinnerUrl);
  await expectGoodPage(ana);
});

test("opening someone else's link asks first", async ({ browser }) => {
  const bo = await newPerson(browser, boLink);
  await bo.goto(await linkFor(organizer, "Sam"));
  await expect(bo.getByRole("heading", { level: 1 })).toHaveText("Continue as Sam?");
  await expectGoodPage(bo);
  await bo.getByRole("link", { name: "Stay as Bo" }).click();
  await expect(bo.getByText("You're Bo")).toBeVisible();
});

test("a stranger sees nothing", async ({ browser }) => {
  const stranger = await newPerson(browser, dinnerUrl);
  await expect(stranger.getByRole("heading")).toHaveText("Open your personal link");
  await expect(stranger.getByText("Soup")).toHaveCount(0);
  await expectGoodPage(stranger);
});
