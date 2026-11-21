import type { Message, Notifier, Recipient } from "./types";

/** Email via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailNotifier implements Notifier {
  readonly channel = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly apiUrl = "https://api.resend.com/emails",
  ) {}

  canReach(r: Recipient): boolean {
    return !!r.email;
  }

  async send(r: Recipient, m: Message): Promise<void> {
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [r.email], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
