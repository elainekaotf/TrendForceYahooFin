# Dispatch proxy (Cloudflare Worker)

Holds the real GitHub token server-side so the public dashboard
(`docs/index.html`) never sees it. Visitors only need a shared passcode.

## Deploy

```bash
cd worker
npm install -g wrangler   # if you don't have it
wrangler login
wrangler secret put GH_TOKEN
# paste the fine-grained PAT (Actions: RW + Contents: RW, scoped to this repo)
wrangler secret put DASHBOARD_PASSCODE
# pick a passphrase to share with people you want to have access
wrangler deploy
```

`wrangler deploy` prints the Worker's URL, e.g.
`https://trendforceyahoofin-dispatch.<your-subdomain>.workers.dev`.

Paste that into `PROXY_URL` in `docs/index.html`, commit, and push.

## Rotating access

- To revoke everyone's access: `wrangler secret put DASHBOARD_PASSCODE` with a new value.
- To revoke the GitHub token: regenerate it on GitHub, then `wrangler secret put GH_TOKEN` with the new one.
- Neither requires touching the dashboard's source or notifying GitHub Pages.
