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
const STALE_PENDING = "-10 minutes";

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
 */
export async function deliver(
  env: Env,
  notifiers: Notifier[],
  dinnerId: string,
  kind: ReminderKind,
  recipient: Recipient,
  message: Message,
): Promise<void> {
  for (const n of notifiers) {
    if (!recipient.channels.includes(n.channel) || !n.canReach(recipient)) continue;
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
