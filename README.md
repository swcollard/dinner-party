# dinner-party
Webapp for coordinating dinner party hosting with friends

## Running locally

Needs Node 22 or later.

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and set both secrets. If you already have a `.dev.vars`,
   just add `LINK_SECRET` (`openssl rand -hex 32`) and check that `PUBLIC_BASE_URL` is `http://localhost:8787`.
3. `npm run dev`, which also creates the local database
4. Open <http://localhost:8787/setup> and enter your `SETUP_SECRET` to become the first organizer

To try it as someone else, copy their link from Members into a private window.

### On a phone

On the same Wi-Fi, replacing the address with your computer's:

```sh
npm run dev -- --ip 0.0.0.0 --var PUBLIC_BASE_URL:http://192.168.1.20:8787
```

Copy and Share need HTTPS. With `cloudflared` installed, run these in two terminals
(the tunnel is public while it runs, so use a strong `SETUP_SECRET`):

```sh
cloudflared tunnel --url http://localhost:8787
npm run dev -- --var PUBLIC_BASE_URL:https://<your-tunnel>.trycloudflare.com
```

## Known limits

- Calendar entries are a snapshot. If a dinner moves or is cancelled, anything already added to a calendar
  stays as it was, so hosts should tell people to update it.

## Tests

```sh
npm test
npm run typecheck
npx playwright install chromium-headless-shell   # once
npm run e2e
```
