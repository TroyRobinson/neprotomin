// Simple NE probe script (Node 20+ required)
// Usage:
//   npm run ne:probe -- --base=https://neighborhood-explorer-staging.herokuapp.com
// or rely on .env VITE_NE_PROXY_TARGET / your chosen base

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
}));

const base = args.base || process.env.NE_BASE || 'https://neighborhood-explorer-staging.herokuapp.com';
const token = process.env.VITE_NE_API_TOKEN || process.env.NE_TOKEN || '';

function url(path) {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/$/, '')}${trimmed}`;
}

async function get(path) {
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = token.startsWith('Token ') ? token : `Token ${token}`;
  const u = url(path);
  process.stdout.write(`GET ${u}\n`);
  const res = await fetch(u, { headers });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: res.ok, status: res.status, text };
  }
}

async function main() {
  const results = [];
  results.push(['categories.json', await get('/api/categories.json')]);
  results.push(['units?format=api', await get('/api/units/?format=api')]);
  results.push(['statistics?format=api', await get('/api/statistics/?format=api')]);
  results.push(['statistic_map_points?format=api&geometry=county', await get('/api/statistic_map_points/?format=api&geometry=county')]);

  for (const [label, res] of results) {
    if (res.ok && res.json) {
      console.log(`✔ ${label}: ${res.status}`);
      const preview = Array.isArray(res.json) ? res.json.slice(0, 2) : res.json.results ? { count: res.json.count, sample: res.json.results.slice?.(0, 1) } : Object.keys(res.json);
      console.dir(preview, { depth: 2, colors: true });
    } else {
      console.log(`✘ ${label}: ${res.status}`);
      console.log(typeof res.text === 'string' ? res.text.slice(0, 200) + '…' : res.text);
    }
  }
}

main().catch((e) => {
  console.error('Probe failed', e);
  process.exit(1);
});

