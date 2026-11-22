import type { Env } from "../env";
import { hourIn, todayIn } from "../lib/time";
import { deliver, getNotifiers, MAX_ATTEMPTS, sendBudget, STALE_PENDING, type SendBudget } from "./index";
import { buildMessage, dueReminders, type DinnerContext } from "./messages";
import type { Notifier, Recipient, ReminderKind } from "./types";

interface DinnerRow {
  id: string;
  group_id: string;
  date: string;
  start_time: string;
  menu: string | null;
  host_id: string;
  group_name: string;
  chat_url: string | null;
  timezone: string;
  rsvp_deadline_days: number;
  reminder_hour: number;
  host_name: string;
  host_address: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  notify_channels: string;
}

const DINNER_SQL = `
  SELECT d.id, d.group_id, d.date, d.start_time, d.menu, d.host_id,
         g.name AS group_name, g.chat_url, g.timezone, g.rsvp_deadline_days, g.reminder_hour,
         h.name AS host_name, h.address AS host_address
  FROM dinners d
  JOIN groups g ON g.id = d.group_id
  JOIN members h ON h.id = d.host_id`;

const memberRecipient = (m: MemberRow): Recipient => ({
  key: `member:${m.id}`,
  name: m.name,
  email: m.email,
  phone: m.phone,
  channels: JSON.parse(m.notify_channels) as string[],
});

const context = (d: DinnerRow, env: Env, withAddress: boolean): DinnerContext => ({
  groupName: d.group_name,
  date: d.date,
  startTime: d.start_time,
  hostName: d.host_name,
  address: withAddress ? d.host_address : null,
  menu: d.menu,
  chatUrl: d.chat_url,
  appUrl: env.PUBLIC_BASE_URL,
});

/**
 * Tell a member it's their turn to host. Called when a dinner is scheduled or the host is
 * overridden, and again by the cron to retry a failed or abandoned attempt.
 */
export async function notifyHostAssigned(
  env: Env,
  dinnerId: string,
  notifiers: Notifier[] = getNotifiers(env),
  budget?: SendBudget,
): Promise<void> {
  try {
    if (notifiers.length === 0) return;
    const d = await env.DB.prepare(`${DINNER_SQL} WHERE d.id = ?`).bind(dinnerId).first<DinnerRow>();
    if (!d) return;
    const host = await env.DB.prepare(
      "SELECT id, name, email, phone, notify_channels FROM members WHERE id = ? AND active = 1",
    )
      .bind(d.host_id)
      .first<MemberRow>();
    if (!host) return;
    await deliver(
      env,
      notifiers,
      d.id,
      "host_assigned",
      memberRecipient(host),
      buildMessage("host_assigned", host.name, context(d, env, false)),
      budget,
    );
  } catch (e) {
    console.error("notifyHostAssigned failed", e);
  }
}

/** Email a new member their personal link. Best effort: the admin also gets the link in the API response. */
export async function sendInvite(env: Env, member: Recipient, groupName: string, link: string): Promise<void> {
  for (const n of getNotifiers(env)) {
    if (!n.canReach(member)) continue;
    try {
      await n.send(member, {
        subject: `You're invited to ${groupName}`,
        text: `Hi ${member.name},\n\nYou've been added to ${groupName}. This is your personal link; keep it private, it's how the app knows it's you:\n\n${link}\n\nOpen it on your phone, add it to your home screen, and fill in your dietary needs.`,
      });
    } catch (e) {
      console.error("sendInvite failed", e);
    }
  }
}

/** Whether at least one configured channel can reach this person. */
export const canNotify = (env: Env, r: Recipient): boolean => getNotifiers(env).some((n) => n.canReach(r));

/** Send a member their fresh personal link. Unlike invites this throws if nothing could be delivered. */
export async function sendNewLink(env: Env, member: Recipient, groupName: string, link: string): Promise<void> {
  const message = {
    subject: `Your new ${groupName} link`,
    text: `Hi ${member.name},\n\nAn organizer sent you a fresh personal link for ${groupName}. Your old link no longer works. Keep this one private:\n\n${link}\n\nIf you subscribe to the calendar feed, use the new calendar URL shown in the app.`,
  };
  const errors: unknown[] = [];
  for (const n of getNotifiers(env)) {
    if (!n.canReach(member)) continue;
    try {
      await n.send(member, message);
      return;
    } catch (e) {
      errors.push(e);
    }
  }
  throw new Error(`could not deliver link: ${errors.map(String).join("; ") || "no channel available"}`);
}

/**
 * Cron (every 15 minutes). Retries host-assigned emails that failed or were abandoned,
 * then, for every upcoming dinner past its group's reminder hour (in the group's own
 * timezone), sends whichever reminders are due today. `deliver` de-duplicates, so
 * frequent runs are safe, and the send budget keeps each run under the subrequest limit.
 */
export async function runReminders(env: Env, now: Date, notifiers: Notifier[] = getNotifiers(env)): Promise<void> {
  if (notifiers.length === 0) return;
  const budget = sendBudget(env);

  // host_assigned is sent at request time, not by this loop, so retries happen here. Only the
  // dinner's current host counts: a failure for someone since replaced by an override is moot.
  const { results: retries } = await env.DB.prepare(
    `SELECT n.dinner_id FROM notifications n
     JOIN dinners d ON d.id = n.dinner_id
     WHERE n.kind = 'host_assigned' AND n.recipient = 'member:' || d.host_id
       AND d.status = 'scheduled' AND d.date >= date('now', '-1 day')
       AND n.attempts < ?
       AND (n.status = 'failed' OR (n.status = 'pending' AND n.updated_at < datetime('now', ?)))`,
  )
    .bind(MAX_ATTEMPTS, STALE_PENDING)
    .all<{ dinner_id: string }>();
  for (const r of retries) {
    if (budget.remaining <= 0) return;
    await notifyHostAssigned(env, r.dinner_id, notifiers, budget);
  }

  const { results: dinners } = await env.DB.prepare(
    `${DINNER_SQL}
     WHERE d.status = 'scheduled' AND d.date BETWEEN date('now', '-1 day') AND date('now', '+30 day')`,
  ).all<DinnerRow>();

  for (const d of dinners) {
    if (budget.remaining <= 0) return; // the rest goes out on the next run
    if (hourIn(d.timezone, now) < d.reminder_hour) continue;
    const kinds = dueReminders(d.date, todayIn(d.timezone, now), d.rsvp_deadline_days);
    if (kinds.length === 0) continue;

    const [members, rsvps, guests] = await Promise.all([
      env.DB.prepare(
        "SELECT id, name, email, phone, notify_channels FROM members WHERE group_id = ? AND active = 1",
      )
        .bind(d.group_id)
        .all<MemberRow>(),
      env.DB.prepare("SELECT member_id, response FROM rsvps WHERE dinner_id = ?")
        .bind(d.id)
        .all<{ member_id: string; response: string }>(),
      env.DB.prepare("SELECT id, name, email, phone FROM guests WHERE dinner_id = ? AND response != 'no'")
        .bind(d.id)
        .all<{ id: string; name: string; email: string | null; phone: string | null }>(),
    ]);
    const response = new Map(rsvps.results.map((r) => [r.member_id, r.response]));

    for (const kind of kinds) {
      const targets = recipientsFor(kind, d, members.results, response, guests.results);
      const withAddress = kind === "day_before" || kind === "day_of";
      for (const r of targets) {
        await deliver(env, notifiers, d.id, kind, r, buildMessage(kind, r.name, context(d, env, withAddress)), budget);
      }
    }
  }
}

function recipientsFor(
  kind: ReminderKind,
  d: DinnerRow,
  members: MemberRow[],
  response: Map<string, string>,
  guests: { id: string; name: string; email: string | null; phone: string | null }[],
): Recipient[] {
  switch (kind) {
    case "rsvp_deadline":
      // Everyone who hasn't answered yet (the host is implicitly coming).
      return members.filter((m) => m.id !== d.host_id && !response.has(m.id)).map(memberRecipient);
    case "day_before":
    case "day_of": {
      const attending = members.filter(
        (m) => m.id === d.host_id || response.get(m.id) === "yes" || response.get(m.id) === "maybe",
      );
      return [
        ...attending.map(memberRecipient),
        // Guests only get email: it's the one channel they can't have opted out of.
        ...guests.map((g) => ({ key: `guest:${g.id}`, name: g.name, email: g.email, phone: g.phone, channels: ["email"] })),
      ];
    }
    case "host_assigned":
      return []; // sent immediately, not by cron
  }
}
