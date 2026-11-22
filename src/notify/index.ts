import type { Env } from "../env";
import { ResendEmailNotifier } from "./email";
import type { Message, Notifier, Recipient, ReminderKind } from "./types";

/** The channels that are configured. Add WhatsApp etc. here once implemented. */
export function getNotifiers(env: Env): Notifier[] {
  const notifiers: Notifier[] = [];
  if (env.RESEND_API_KEY) {
    notifiers.push(
      new ResendEmailNotifier(
        env.RESEND_API_KEY,
        env.EMAIL_FROM ?? "Dinner Party <onboarding@resend.dev>",
        env.EMAIL_API_URL,
      ),
    );
  }
  return notifiers;
}

/** Give up on a (dinner, kind, recipient, channel) after this many failed or abandoned attempts. */
export const MAX_ATTEMPTS = 3;
/** A claim still 'pending' after this long means the worker died mid-send; it may be claimed again. */
export const STALE_PENDING = "-10 minutes";

/**
 * How many sends one invocation may still attempt. Workers cap subrequests per invocation,
 * so a big batch of reminders must be spread over several cron runs; whatever is left
 * unsent (never claimed) is simply picked up next time.
 */
export interface SendBudget {
  remaining: number;
}
export const DEFAULT_SEND_BUDGET = 40;

export function sendBudget(env: Env): SendBudget {
  const n = Number.parseInt(env.REMINDER_SEND_BUDGET ?? "", 10);
  return { remaining: Number.isFinite(n) && n > 0 ? n : DEFAULT_SEND_BUDGET };
}

/**
 * Send `message` to `recipient` on each channel they opted into, at most once per
 * (dinner, kind, recipient, channel) under normal operation.
 *
 * Delivery is claim -> send -> record, in D1:
 *  - The claim row is written before sending so overlapping cron runs can't double-send.
 *  - Success marks it 'sent'. Failure marks it 'failed', and later runs retry it, up to
 *    MAX_ATTEMPTS, so a permanently bad address stops being retried (and is logged).
 *  - If the worker dies mid-send the row stays 'pending'; after STALE_PENDING it is
 *    claimed again so the reminder isn't lost. This is at-least-once: in that rare case
 *    a reminder whose email did go out may be sent a second time, which beats silence.
 *  - With a `budget`, stops (without claiming) once the budget is spent.
 */
export async function deliver(
  env: Env,
  notifiers: Notifier[],
  dinnerId: string,
  kind: ReminderKind,
  recipient: Recipient,
  message: Message,
  budget?: SendBudget,
): Promise<void> {
  for (const n of notifiers) {
    if (!recipient.channels.includes(n.channel) || !n.canReach(recipient)) continue;
    // Out of budget: don't claim, so the next run sends it instead of seeing a stuck 'pending'.
    if (budget && budget.remaining <= 0) return;
    const key = [dinnerId, kind, recipient.key, n.channel] as const;

    const claim = await env.DB.prepare(
      `INSERT INTO notifications (dinner_id, kind, recipient, channel, status, attempts, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 1, datetime('now'))
       ON CONFLICT (dinner_id, kind, recipient, channel) DO UPDATE
         SET status = 'pending', attempts = attempts + 1, updated_at = datetime('now')
         WHERE attempts < ?
           AND (status = 'failed' OR (status = 'pending' AND updated_at < datetime('now', ?)))`,
    )
      .bind(...key, MAX_ATTEMPTS, STALE_PENDING)
      .run();
    if (!claim.meta.changes) continue; // already sent, in flight, or out of attempts
    if (budget) budget.remaining--;

    try {
      await n.send(recipient, message);
      await env.DB.prepare(
        `UPDATE notifications SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now')
         WHERE dinner_id = ? AND kind = ? AND recipient = ? AND channel = ?`,
      )
        .bind(...key)
        .run();
    } catch (e) {
      const row = await env.DB.prepare(
        `UPDATE notifications SET status = 'failed', updated_at = datetime('now')
         WHERE dinner_id = ? AND kind = ? AND recipient = ? AND channel = ? RETURNING attempts`,
      )
        .bind(...key)
        .first<{ attempts: number }>();
      const giveUp = (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
      console.error(
        `notify ${giveUp ? "GAVE UP" : "failed, will retry"}: ${kind} -> ${recipient.key} via ${n.channel} (attempt ${row?.attempts})`,
        e,
      );
    }
  }
}
