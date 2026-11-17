import type { Env } from "./env";

/** STUB: send an email via Resend (or Email Workers). */
export async function sendEmail(
  _env: Env,
  _to: string,
  _subject: string,
  _body: string,
): Promise<void> {
  // TODO: POST https://api.resend.com/emails with env.RESEND_API_KEY
}

/** Cron entry point: find dinners needing reminders and notify members. */
export async function runReminders(_env: Env, _now: Date): Promise<void> {
  // TODO:
  //  - dinners in ~7 days with no host-confirmed menu -> nudge host
  //  - dinners tomorrow -> remind everyone with a "yes"/"maybe" RSVP
  //  - RSVP deadline approaching -> nudge members with no response
}
