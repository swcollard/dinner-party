/**
 * Channel-agnostic notifications. A channel (email today, WhatsApp/SMS/push
 * later) implements `Notifier`; reminder logic never mentions a specific channel.
 */
export type Channel = "email" | "whatsapp";

export interface Recipient {
  /** Stable id for de-duplication: 'member:<id>' or 'guest:<id>'. */
  key: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Channels this person opted into. */
  channels: readonly string[];
}

export interface Message {
  subject: string;
  text: string;
}

export interface Notifier {
  readonly channel: Channel;
  /** Whether we have what this channel needs (an email address, a phone number...). */
  canReach(r: Recipient): boolean;
  send(r: Recipient, m: Message): Promise<void>;
}

export type ReminderKind = "host_assigned" | "rsvp_deadline" | "day_before" | "day_of";
