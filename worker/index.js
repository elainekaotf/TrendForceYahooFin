// Backend proxy for docs/index.html — holds the real GitHub token as a
// Worker secret so visitors to the dashboard never see or hold it
// themselves. Only a shared passcode (also a secret) gates access, so
// random people who find the Pages URL can't spam the Action.

const OWNER = 'elainekaotf';
const REPO = 'TrendForceYahooFin';
const WORKFLOW_FILE = 'scrape-on-demand.yml';

// Pages URL — restrict CORS to just this origin so the token-holding
// Worker can't be driven from an arbitrary third-party page.
const ALLOWED_ORIGIN = 'https://elainekaotf.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Passcode',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function gh(env, path, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TrendForceYahooFin-dashboard',
      ...(opts.headers || {}),
    },
  });
}

function checkPasscode(env, req) {
  const provided = req.headers.get('X-Dashboard-Passcode') || '';
  return env.DASHBOARD_PASSCODE && provided === env.DASHBOARD_PASSCODE;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (!checkPasscode(env, request)) {
      return json({ error: 'Missing or incorrect passcode.' }, 401);
    }

    if (url.pathname === '/api/dispatch' && request.method === 'POST') {
      const { symbol, from, to } = await request.json();
      if (!symbol) return json({ error: 'symbol is required' }, 400);

      const runIdToken = crypto.randomUUID();
      const dispatchedAt = new Date().toISOString();

      const res = await gh(env, `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { symbol, from: from || '2018-01-01', to: to || '', run_id: runIdToken },
        }),
      });

      if (res.status !== 204) {
        const body = await res.text();
        return json({ error: `Dispatch failed (${res.status}): ${body}` }, 502);
      }

      return json({ runIdToken, dispatchedAt });
    }

    if (url.pathname === '/api/status' && request.method === 'GET') {
      const dispatchedAt = url.searchParams.get('dispatchedAt');
      const runId = url.searchParams.get('runId'); // GitHub's numeric run id, once known
      if (!dispatchedAt && !runId) return json({ error: 'dispatchedAt or runId is required' }, 400);

      if (runId) {
        const res = await gh(env, `/repos/${OWNER}/${REPO}/actions/runs/${runId}`);
        const run = await res.json();
        return json({ run });
      }

      const res = await gh(env, `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`);
      const data = await res.json();
      const run = (data.workflow_runs || []).find(r => new Date(r.created_at) >= new Date(dispatchedAt));
      return json({ run: run || null });
    }

    return json({ error: 'Not found' }, 404);
  },
};
