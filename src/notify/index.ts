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

/**
 * Send `message` to `recipient` on each channel they opted into, at most once
 * per (dinner, kind, recipient, channel). The log row is claimed before sending
 * so overlapping cron runs can't double-send; if sending fails the claim is
 * released so the next run retries.
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
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO notifications (dinner_id, kind, recipient, channel) VALUES (?, ?, ?, ?)",
    )
      .bind(dinnerId, kind, recipient.key, n.channel)
      .run();
    if (!claim.meta.changes) continue; // already sent
    try {
      await n.send(recipient, message);
    } catch (e) {
      console.error(`notify failed: ${kind} -> ${recipient.key} via ${n.channel}`, e);
      await env.DB.prepare(
        "DELETE FROM notifications WHERE dinner_id = ? AND kind = ? AND recipient = ? AND channel = ?",
      )
        .bind(dinnerId, kind, recipient.key, n.channel)
        .run();
    }
  }
}
