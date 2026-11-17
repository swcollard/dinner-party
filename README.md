# dinner-party

Webapp for coordinating dinner party hosting with friends.

**Stack:** Cloudflare Workers ([Hono](https://hono.dev)) · D1 (SQLite) · Cron Triggers · TypeScript.
Planned: R2 for photos, Resend for email.

## Status

Stub. Working: schema, fairness-weighted host rotation, ICS generation, RSVP and
scheduling routes (behind a not-yet-implemented auth). See [docs/DESIGN.md](docs/DESIGN.md)
for the roadmap and open questions.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev          # wrangler dev
npm test && npm run typecheck
```

Deploy: `wrangler d1 create dinner-party`, put the id in `wrangler.jsonc`,
`npm run db:migrate:remote`, `wrangler secret put SESSION_SECRET`, `npm run deploy`.

## Layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Hono routes + `scheduled` handler |
| `src/lib/rotation.ts` | Pure host-selection logic (fewest hosted, then longest ago) |
| `src/lib/ics.ts` | Calendar feed builder |
| `src/auth.ts` | Magic-link auth (stub, returns 501) |
| `src/notify.ts` | Email + reminder cron (stub) |
| `migrations/` | D1 schema; every table carries `group_id` |
