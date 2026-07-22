# Dispatch proxy (Cloudflare Worker)

Holds the real GitHub token server-side so the public dashboard
(`docs/index.html`) never sees it. Visitors only need a shared passcode.

## Deploy

Run everything via `npx` from inside `worker/` — this avoids installing
wrangler globally (which needs sudo on some Macs) and always uses a pinned
local version instead.

```bash
cd worker
npx wrangler login
npx wrangler secret put GH_TOKEN
# paste the fine-grained PAT (Actions: RW + Contents: RW, scoped to this repo)
npx wrangler secret put DASHBOARD_PASSCODE
# pick a passphrase to share with people you want to have access
npx wrangler deploy
```

The first `npx wrangler ...` will ask to install wrangler locally (into
`worker/node_modules`) — say yes; no `sudo` needed.

`wrangler deploy` prints the Worker's URL, e.g.
`https://trendforceyahoofin-dispatch.<your-subdomain>.workers.dev`.

Paste that into `PROXY_URL` in `docs/index.html`, commit, and push.

## Rotating access

- To revoke everyone's access: `npx wrangler secret put DASHBOARD_PASSCODE` with a new value.
- To revoke the GitHub token: regenerate it on GitHub, then `npx wrangler secret put GH_TOKEN` with the new one.
- Neither requires touching the dashboard's source or notifying GitHub Pages.
