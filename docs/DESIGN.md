# Design notes

## Decisions (from the project owner)

| Topic | Decision | Where |
|---|---|---|
| Rotation | Fixed order. Skip weeks and cancellations allowed. A cancelled host moves to the next week. | `lib/rotation.ts` |
| Swaps | Override whose turn it is for one dinner; nobody has to take a different shift. | `PUT /dinners/:id/host`, `rotation_host_id` vs `host_id` |
| Time zone | Central, per group (`groups.timezone`, default `America/Chicago`). | `lib/time.ts` |
| Tenancy | Many groups. `group_id` everywhere. | schema, every route |
| Admins | At least one per group; more can be added; what members may do is configurable. | `lib/permissions.ts`, `PUT /group` |
| Guests | Supported, with optional email/phone. | `guests` table |
| Auth | v1: no accounts, personal links (magic-link style). Google later. | `auth.ts`, `access_tokens` |
| Menu | Host picks, potluck, or both, per dinner. | `dinners.menu_mode`, `dishes` |
| Dietary | Required profile data (yes/"none"); needed before RSVP yes. | `routes/me.ts`, `routes/attendance.ts` |
| Chat | Link out to the group chat (WhatsApp). | `groups.chat_url` |
| Notifications | Email for v1 behind a channel interface. Reminders: host assigned, RSVP deadline, day-before, day-of. | `src/notify/` |
| Calendar | ICS feed per member. | `routes/calendar.ts` |
| Backups | Weekly. | `src/backup.ts` |
| Experience | Mobile-first PWA. | `public/` |
| Environments | local / staging / production. | `wrangler.jsonc` |

## Model

- `dinners.rotation_host_id` is whose turn it was; `dinners.host_id` is who hosts. Next turn (`nextTurn`):
  1. If a cancelled dinner's turn is still owed (no dinner names it in `makeup_for`), the oldest one is repaid: the new dinner
     goes to that host with `makeup_for` set. A cancelled make-up is owed again; a turn owed to someone who left lapses.
  2. Otherwise walk `members.rotation_position` from the latest *regular* dinner (`makeup_for IS NULL`, cancelled ones included),
     passing over inactive members. Make-ups never move this pointer, so nobody already scheduled is bumped.
- `skip_dates` are weeks with no dinner (not dinners, so they consume no turn).
- `access_tokens` store only SHA-256 hashes of personal links. `members.calendar_token` is a separate secret for the ICS URL.
- `notifications` logs `(dinner, kind, recipient, channel)` with a delivery state (`pending`/`sent`/`failed`, `attempts`). Sends are
  claimed before sending so overlapping runs can't double-send; failures retry up to 3 times then are given up on and logged; a claim
  stuck `pending` for 10+ minutes (worker died) is claimed again. This is at-least-once: very rarely a reminder may arrive twice.
- A dinner is open only while `scheduled` and not past (group timezone). `closedReason()` enforces this on every write immediately;
  the cron then flips past dinners to `done`.
- Reissuing a member's link also rotates their calendar token, because the calendar URL exposes host addresses. Backups omit
  calendar tokens for the same reason.
- Role changes, per-member grants and the group's default member grants are admin-only, so no delegate can widen permissions.

## Privacy

Addresses and allergy data are sensitive. Every `/api` route requires a valid link; results are `no-store` and `noindex`; the host
address is only returned to members of the dinner's group while the dinner is still on; everyone's dietary needs go only to the host and editors
(required for yes *and* maybe; guests added without any show as "not provided"); a member-management delegate can never receive someone
else's personal link (it is emailed to that member), since that would let them act as them; guest contact
details are never returned by the API; the address appears in emails only on day-before/day-of reminders. Cross-group access returns 404.

## Confirmed assumptions

All five confirmed by the project owner.

1. "Central Standard Time" means US Central **with daylight saving** (`America/Chicago`), not a fixed UTC-6.
2. Only people with the `override_host` permission (admins by default) can change a host. A host can cancel their own dinner but cannot hand it to someone else.
3. Guests with an email get the day-before / day-of reminders, including the address.
4. Guests can't RSVP themselves in v1 (no link for them); the member who brought them sets their response.
5. The WhatsApp item is a link to the group chat. Sending reminders over WhatsApp later needs the WhatsApp Business API with pre-approved templates.

## Open / not built yet

- Notify attendees when a dinner is cancelled or the host changes.
- Guest self-service links; Google sign-in.
- WhatsApp (or SMS/push) channel: implement `Notifier` and register it in `notify/index.ts`.
- ICS uses floating local times; add a `VTIMEZONE` if members travel.
- PNG/maskable icons (iOS home-screen icon) and a richer UI: menu editing, potluck sign-up, members/admin screens, skip weeks.
- Rate limiting for `/admin/groups` (use a Cloudflare WAF rate-limit rule) and error alerting.
- Verify the Workers subrequest limit for the chosen plan and tune `REMINDER_SEND_BUDGET`; for many groups, fan reminders out
  through Cloudflare Queues instead of one cron invocation.
- Post-dinner recap with photos (R2), ratings, AI menu suggestions, cost splitting.
- Ops: who gets paged when it breaks on a Saturday night? Observability is on (Workers logs); alerting and an owner need deciding.
