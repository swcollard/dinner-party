# dinner-party

Webapp for coordinating dinner party hosting with friends: a fixed host rotation
with skips, cancellations and one-off overrides; RSVPs with dietary info; host-picked
menus or potluck sign-up; reminders; and a calendar feed. Mobile-first PWA, no accounts
(personal links), supports many groups.

**Stack:** Cloudflare Workers ([Hono](https://hono.dev)) · D1 · R2 · Cron Triggers · static PWA · TypeScript.

## How it works

- **Rotation** (`src/lib/rotation.ts`): members have a fixed order. A cancelled dinner's turn carries to
  the next dinner; overriding a host for one dinner never shifts anyone's turn; skipped weeks consume no turn.
- **No accounts**: each member has a secret personal link (`https://app/#t=<token>`). Only a SHA-256 hash is stored;
  links can be reissued/revoked. Google sign-in can be layered on later.
- **Multi-group**: every table carries `group_id` and every query is scoped to the caller's group.
- **Permissions** (`src/lib/permissions.ts`): admins can do everything; a group sets default grants for members and
  admins can grant more per person. Hosts can always manage their own dinner.
- **Notifications** (`src/notify/`): channel-agnostic `Notifier` interface; email (Resend) is implemented. Reminders:
  host assigned, RSVP deadline, day-before, day-of. Delivery state is tracked per recipient: no double-sends, failures are
  retried up to 3 times then given up on (logged), and a send abandoned by a dead worker is picked up again.
- **Hourly cron**: sends due reminders and marks past dinners `done`. Past dinners are read-only immediately, not only after the job runs.
- **Backups**: weekly cron exports every table to R2 (`src/backup.ts`).

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars     # set SETUP_SECRET
npm run db:migrate:local
npm run dev                        # http://localhost:8787
npm test && npm run typecheck
```

Create a group (prints the admin's personal link):

```sh
curl -X POST localhost:8787/admin/groups -H "x-setup-secret: $SETUP_SECRET" -H 'content-type: application/json' \
  -d '{"name":"Sunday Supper","admin":{"name":"Alex","email":"alex@example.com"}}'
```

### End-to-end smoke test

`scripts/smoke.sh` drives the real API against `wrangler dev` (local D1) and asserts rotation, permissions, privacy,
calendar and cross-group isolation. To include reminders, run the mock email server and point the Worker at it:

```sh
scripts/mock-email.py /tmp/emails.jsonl 9999 &
# .dev.vars: RESEND_API_KEY=test   EMAIL_API_URL=http://localhost:9999/emails
npm run dev                                                    # in another terminal
MOCK_EMAIL_LOG=/tmp/emails.jsonl SETUP_SECRET=... npm run smoke
```

## API (all under `/api` need `Authorization: Bearer <token>`)

| Route | Who |
|---|---|
| `GET/PUT /api/me` | any member (profile, dietary info, address, notification channels) |
| `GET /api/members`, `POST /api/members`, `PUT /api/members/order`, `PUT /api/members/:id` | `manage_members` (role/permission changes: admin only; a member hosting an upcoming dinner can't be deactivated) |
| `POST /api/members/:id/link` | own link: anyone, link returned. Others': admins get the link back; `manage_members` delegates trigger an email to the member and never see it. Also rotates the member's calendar URL |
| `PUT /api/group` | `manage_settings` |
| `GET /api/dinners`, `GET /api/dinners/:id` | any member (dietary needs only for host/editors) |
| `POST /api/dinners/schedule-next` | `schedule_dinners` |
| `PUT /api/dinners/:id` (menu, notes, time, menu style) | host or `edit_any_dinner` |
| `PUT /api/dinners/:id/host` | `override_host` |
| `POST /api/dinners/:id/cancel` | host or `cancel_dinners` |
| `GET/POST /api/skips`, `DELETE /api/skips/:date` | `skip_weeks` (GET: any member) |
| `PUT /api/dinners/:id/rsvp` | any member (yes/maybe require dietary info). Past dinners are read-only |
| `POST/PUT/DELETE /api/dinners/:id/guests[/:guestId]` | any member for their own guests; host/editors for anyone's |
| `POST/DELETE /api/dinners/:id/dishes[/:dishId]` | any member (potluck / "both" menus) |
| `GET /calendar/:calendarToken/dinners.ics` | secret per-member URL |
| `POST /admin/groups` | platform operator, `x-setup-secret` header |
| `GET /healthz` | public |

## Deploy

Environments are `staging` and `production` in `wrangler.jsonc`. The top level is local dev only, with its own worker/database/bucket
names, so a bare `wrangler deploy` can't touch production; always deploy with `--env` (use the `deploy:*` scripts). Per environment:

```sh
npx wrangler d1 create dinner-party-staging        # put the id in wrangler.jsonc
npx wrangler r2 bucket create dinner-party-backups-staging
npx wrangler secret put SETUP_SECRET --env staging
npx wrangler secret put RESEND_API_KEY --env staging   # optional until you want email
npm run db:migrate:staging && npm run deploy:staging
```

Set `PUBLIC_BASE_URL` (and `EMAIL_FROM` once your sending domain is verified in Resend) per environment.
Use Workers Builds (connect the repo in the Cloudflare dashboard) or GitHub Actions for CD; CI here runs typecheck, tests and a
dry-run bundle for every environment.

**Backups**: D1 Time Travel covers 30 days of point-in-time restore. The weekly R2 export (`backups/YYYY-MM-DD/`) is the portable
long-term copy; add an R2 lifecycle rule to expire old ones. A backup is complete only if its `manifest.json` exists.

See [docs/DESIGN.md](docs/DESIGN.md) for decisions, assumptions and open questions.
