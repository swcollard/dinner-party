# Design notes

## MVP scope
1. Invite-only magic-link login
2. Rotation schedule (fairness-weighted) with host swaps/cancellations
3. RSVP (yes/no/maybe + guest count) with dietary info visible to the host
4. Menu field per dinner
5. ICS calendar feed
6. Email reminders via cron

Later: potluck sign-up, photos (R2), post-dinner recap, AI menu suggestions
(respecting everyone's restrictions), cost splitting links.

## Decisions made in the stub (easy to change)
- Hono on Workers, not Next.js: small app, simpler deploy.
- `group_id` on every table so multi-tenant is possible later; the stub assumes one group.
- Rotation = fewest times hosted, then longest ago; cancelled dinners don't count.
- Dinners are weekly on Sundays; dates are plain `YYYY-MM-DD` in the group's timezone.
- Auth: magic link (tokens hashed in `login_tokens`, signed session cookie).

## Open questions
1. One friend group forever, or multi-tenant?
2. Sign-in: magic link (assumed), Cloudflare Access, or Google?
3. Strict round-robin vs. fairness + swaps? Skip weeks / holidays?
4. Host picks the whole menu, or guests sign up to bring dishes?
5. Which notification channel do friends actually read (email, SMS, push, Discord/WhatsApp)?
6. Guests / plus-ones who aren't members?

## TODO (stubbed)
- `src/auth.ts`: request/verify endpoints, session cookie, member loading
- `src/notify.ts`: Resend integration and reminder rules
- Per-member secret token for the ICS URL
- Swap/cancel host endpoint, menu editing, members CRUD, dietary summary
- Frontend (mobile-first SPA / PWA)
- Staging env in `wrangler.jsonc`, CI
