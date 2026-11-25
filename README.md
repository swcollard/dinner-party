# dinner-party
Webapp for coordinating dinner party hosting with friends

## Development

Copy `.dev.vars.example` to `.dev.vars` and fill in both secrets, then:

```sh
npm install
npm run dev        # http://localhost:8787/setup creates the first organizer
npm test
npm run typecheck
```

### Trying it on a real phone

Phones need HTTPS for the links to behave as they will in production. With `cloudflared` installed:

```sh
cloudflared tunnel --url http://localhost:8787
npm run dev -- --var PUBLIC_BASE_URL:https://<your-tunnel>.trycloudflare.com
```
