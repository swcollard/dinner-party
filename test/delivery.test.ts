import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { daysBetween, todayIn } from "../src/lib/time";
import { deliver, type SendBudget } from "../src/notify/index";
import { notifyHostAssigned, runReminders } from "../src/notify/reminders";
import type { Message, Notifier, Recipient } from "../src/notify/types";
import { testDb } from "./helpers/d1";

/** Records every attempt; throws for addresses in `failFor` (like a bouncing mailbox). */
class FakeEmail implements Notifier {
  readonly channel = "email" as const;
  attempts: string[] = [];
  failFor = new Set<string>();
  canReach(r: Recipient) {
    return !!r.email;
  }
  async send(r: Recipient, m: Message) {
    this.attempts.push(`${r.email}|${m.subject}`);
    if (this.failFor.has(r.email!)) throw new Error("mailbox unavailable");
  }
  to(email: string) {
    return this.attempts.filter((a) => a.startsWith(`${email}|`));
  }
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let db: ReturnType<typeof testDb>;
let env: Env;
let email: FakeEmail;

function seed(dinnerDate: string, memberCount = 2) {
  db.sql.exec("INSERT INTO groups (id, name, timezone, reminder_hour) VALUES ('g', 'Supper', 'America/Chicago', 0)");
  const add = db.sql.prepare("INSERT INTO members (id, group_id, name, email, dietary) VALUES (?, 'g', ?, ?, 'none')");
  add.run("h", "Host", "host@example.com");
  for (let i = 1; i <= memberCount; i++) add.run(`m${i}`, `M${i}`, `m${i}@example.com`);
  db.sql
    .prepare("INSERT INTO dinners (id, group_id, host_id, rotation_host_id, date) VALUES ('d', 'g', 'h', 'h', ?)")
    .run(dinnerDate);
}
const row = (recipient: string, kind = "host_assigned") =>
  db.sql
    .prepare("SELECT status, attempts FROM notifications WHERE dinner_id = 'd' AND kind = ? AND recipient = ?")
    .get(kind, recipient) as { status: string; attempts: number } | undefined;

const recipient = (id: string): Recipient => ({ key: `member:${id}`, name: id, email: `${id}@example.com`, channels: ["email"] });
const msg: Message = { subject: "s", text: "t" };

beforeEach(() => {
  db = testDb();
  env = { DB: db.d1, PUBLIC_BASE_URL: "https://dinner.example", SETUP_SECRET: "x" } as Env;
  email = new FakeEmail();
});

describe("deliver", () => {
  beforeEach(() => seed(addDays(todayIn("UTC", new Date()), 20)));

  it("sends once and records it as sent", async () => {
    await deliver(env, [email], "d", "day_before", recipient("m1"), msg);
    await deliver(env, [email], "d", "day_before", recipient("m1"), msg);
    expect(email.attempts).toHaveLength(1);
    expect(row("member:m1", "day_before")).toEqual({ status: "sent", attempts: 1 });
  });

  it("retries a failing address up to 3 attempts, then gives up", async () => {
    email.failFor.add("m1@example.com");
    for (let i = 0; i < 5; i++) await deliver(env, [email], "d", "day_before", recipient("m1"), msg);
    expect(email.attempts).toHaveLength(3);
    expect(row("member:m1", "day_before")).toEqual({ status: "failed", attempts: 3 });
  });

  it("doesn't resend a fresh in-flight claim, but recovers one abandoned by a dead worker", async () => {
    db.sql.exec(`INSERT INTO notifications (dinner_id, kind, recipient, channel, status, attempts, updated_at)
                 VALUES ('d', 'day_before', 'member:m1', 'email', 'pending', 1, datetime('now'))`);
    await deliver(env, [email], "d", "day_before", recipient("m1"), msg);
    expect(email.attempts).toHaveLength(0);

    db.sql.exec("UPDATE notifications SET updated_at = datetime('now', '-30 minutes')");
    await deliver(env, [email], "d", "day_before", recipient("m1"), msg);
    expect(email.attempts).toHaveLength(1);
    expect(row("member:m1", "day_before")).toEqual({ status: "sent", attempts: 2 });
  });

  it("stops without claiming once the budget is spent, so the next run can send it", async () => {
    const budget: SendBudget = { remaining: 1 };
    await deliver(env, [email], "d", "day_before", recipient("m1"), msg, budget);
    await deliver(env, [email], "d", "day_before", recipient("m2"), msg, budget);
    expect(email.attempts).toHaveLength(1);
    expect(row("member:m2", "day_before")).toBeUndefined(); // not left 'pending'

    await deliver(env, [email], "d", "day_before", recipient("m2"), msg, { remaining: 1 });
    expect(email.to("m2@example.com")).toHaveLength(1);
  });
});

describe("host_assigned retries (review finding)", () => {
  beforeEach(() => seed(addDays(todayIn("UTC", new Date()), 20)));

  it("the cron retries a failed host-assigned email until it goes through", async () => {
    email.failFor.add("host@example.com");
    await notifyHostAssigned(env, "d", [email]); // at schedule time: fails
    expect(row("member:h")).toEqual({ status: "failed", attempts: 1 });

    await runReminders(env, new Date(), [email]); // still failing
    expect(row("member:h")).toEqual({ status: "failed", attempts: 2 });

    email.failFor.clear();
    await runReminders(env, new Date(), [email]);
    expect(row("member:h")).toEqual({ status: "sent", attempts: 3 });
    await runReminders(env, new Date(), [email]); // and never again
    expect(email.to("host@example.com")).toHaveLength(3);
  });

  it("doesn't retry for a host who has since been replaced by an override", async () => {
    email.failFor.add("host@example.com");
    await notifyHostAssigned(env, "d", [email]);
    db.sql.exec("UPDATE dinners SET host_id = 'm1' WHERE id = 'd'");
    await runReminders(env, new Date(), [email]);
    expect(email.attempts).toHaveLength(1);
  });
});

describe("runReminders send budget (review finding)", () => {
  it("spreads a large batch over several runs and sends everyone exactly once", async () => {
    const now = new Date();
    const tomorrow = addDays(todayIn("America/Chicago", now), 1);
    expect(daysBetween(todayIn("America/Chicago", now), tomorrow)).toBe(1);
    seed(tomorrow, 5);
    const rsvp = db.sql.prepare("INSERT INTO rsvps (dinner_id, member_id, response) VALUES ('d', ?, 'yes')");
    for (let i = 1; i <= 5; i++) rsvp.run(`m${i}`);
    env = { ...env, REMINDER_SEND_BUDGET: "4" };

    await runReminders(env, now, [email]);
    expect(email.attempts).toHaveLength(4);
    await runReminders(env, now, [email]);
    expect(email.attempts).toHaveLength(6); // host + 5 members, all day-before
    await runReminders(env, now, [email]);
    expect(email.attempts).toHaveLength(6);
    expect(new Set(email.attempts).size).toBe(6);
    const pending = db.sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status = 'pending'").get() as { n: number };
    expect(pending.n).toBe(0);
  });
});
