import fs from 'node:fs/promises';
import { evaluateFourthDown, evaluateThirdDownPlanning } from '../lib/decision-engine.js';

const base = String(process.env.SMOKE_BASE_URL || process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const out = process.env.SMOKE_OUTPUT || 'v051-production-smoke.json';
const tol = 1e-10;
const results = [];
let failed = false;

function record(name, ok, detail='') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}
async function jsonFetch(url, opts={}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { r, text, body };
}
function approx(a,b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) <= tol;
}
function sameTags(a=[], b=[]) {
  return [...a].sort().join('|') === [...b].sort().join('|');
}

console.log(`4TH DOWN v0.5.1 production smoke: ${base}`);

const health = await jsonFetch(`${base}/api/health`);
record('health HTTP 200', health.r.status === 200, `status ${health.r.status}`);
record('release version', health.body?.releaseVersion === 'v0.5.1', String(health.body?.releaseVersion));
record('release promoted', health.body?.releaseStatus === 'PROMOTED' && health.body?.releaseAudit === 'PROMOTE', `${health.body?.releaseStatus}/${health.body?.releaseAudit}`);
record('evaluated candidate pinned', health.body?.evaluatedCandidateCommit === '8daaa8f75787e4f28d25af6462142518f4594e9a', String(health.body?.evaluatedCandidateCommit));

const home = await fetch(`${base}/`);
const homeText = await home.text();
record('homepage HTTP 200', home.status === 200, `status ${home.status}`);
record('homepage release label', homeText.includes('MODEL v0.5.1') && homeText.includes('PROMOTED'), 'v0.5.1 promoted label');

const cases = [
  {
    name: 'neutral structural state',
    input: { ydstogo: 2, yardline100: 43, scoreDiff: 0, secondsRemaining: 1800, timeouts: 3, opponentTimeouts: 3 }
  },
  {
    name: 'outside endgame boundary',
    input: { ydstogo: 4, yardline100: 35, scoreDiff: -1, secondsRemaining: 301, timeouts: 2, opponentTimeouts: 2 }
  },
  {
    name: 'gated four-minute long-yardage state',
    input: { ydstogo: 17, yardline100: 82, scoreDiff: -1, secondsRemaining: 240, timeouts: 3, opponentTimeouts: 3 }
  },
  {
    name: 'terminal must-touchdown state',
    input: { ydstogo: 11, yardline100: 21, scoreDiff: -4, secondsRemaining: 43, timeouts: 3, opponentTimeouts: 3 }
  },
  {
    name: 'terminal punt-scarcity state',
    input: { ydstogo: 10, yardline100: 70, scoreDiff: -1, secondsRemaining: 40, timeouts: 2, opponentTimeouts: 3 }
  },
  {
    name: 'long field-goal no-boost state',
    input: { ydstogo: 5, yardline100: 47, scoreDiff: -1, secondsRemaining: 20, timeouts: 1, opponentTimeouts: 2 }
  },
  {
    name: 'short-yardage tying-FG guard',
    input: { ydstogo: 1, yardline100: 3, scoreDiff: -3, secondsRemaining: 22, timeouts: 2, opponentTimeouts: 2 }
  },
  {
    name: 'longer tying-FG state',
    input: { ydstogo: 8, yardline100: 24, scoreDiff: -3, secondsRemaining: 35, timeouts: 2, opponentTimeouts: 2 }
  }
];

for (const c of cases) {
  const expected = evaluateFourthDown(c.input);
  const remote = await jsonFetch(`${base}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(c.input)
  });

  record(`${c.name}: HTTP`, remote.r.status === 200, `status ${remote.r.status}`);
  if (remote.r.status !== 200 || !remote.body) continue;

  const got = remote.body;
  record(`${c.name}: release stamp`, got.releaseVersion === 'v0.5.1', String(got.releaseVersion));
  record(`${c.name}: optimal`, got.optimal === expected.optimal, `${got.optimal} vs ${expected.optimal}`);
  record(`${c.name}: certainty`, got.certainty === expected.certainty, `${got.certainty} vs ${expected.certainty}`);

  for (const action of ['GO','FG','PUNT']) {
    const e = expected.options?.[action];
    const g = got.options?.[action];
    const ok = (e == null && g == null) || approx(e,g);
    record(`${c.name}: ${action} WP`, ok, `${g} vs ${e}`);
  }

  record(
    `${c.name}: endgame active`,
    Boolean(got.diagnostics?.endgame?.active) === Boolean(expected.diagnostics?.endgame?.active),
    `${Boolean(got.diagnostics?.endgame?.active)} vs ${Boolean(expected.diagnostics?.endgame?.active)}`
  );

  record(
    `${c.name}: endgame tags`,
    sameTags(got.diagnostics?.endgame?.tags || [], expected.diagnostics?.endgame?.tags || []),
    `${(got.diagnostics?.endgame?.tags || []).join(',') || 'none'}`
  );
}

const thirdInput = { ydstogo: 2, yardline100: 35, scoreDiff: -3, secondsRemaining: 180, timeouts: 2, opponentTimeouts: 2 };
const expectedThird = evaluateThirdDownPlanning(thirdInput);
const third = await jsonFetch(`${base}/api/evaluate-third`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(thirdInput)
});
record('third-down planner HTTP', third.r.status === 200, `status ${third.r.status}`);
record('third-down planner parity', third.body?.twoDownTerritory === expectedThird.twoDownTerritory, `${third.body?.twoDownTerritory} vs ${expectedThird.twoDownTerritory}`);

let scoreboardOk = false;
let scoreboardDetail = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  const sb = await jsonFetch(`${base}/api/scoreboard`);
  if (sb.r.status === 200 && Array.isArray(sb.body?.games)) {
    scoreboardOk = true;
    scoreboardDetail = `${sb.body.games.length} games`;
    break;
  }
  scoreboardDetail = `attempt ${attempt}: status ${sb.r.status}`;
  await new Promise(r => setTimeout(r, 3000));
}
record('ESPN scoreboard adapter', scoreboardOk, scoreboardDetail);

let liveOk = false;
let liveDetail = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  const live = await jsonFetch(`${base}/api/live`);
  if (live.r.status === 200 && Array.isArray(live.body?.games) && Array.isArray(live.body?.ledger)) {
    liveOk = true;
    liveDetail = `${live.body.games.length} games / ${live.body.ledger.length} ledger rows`;
    break;
  }
  liveDetail = `attempt ${attempt}: status ${live.r.status}`;
  await new Promise(r => setTimeout(r, 3000));
}
record('live board adapter', liveOk, liveDetail);

const report = {
  schemaVersion: 1,
  releaseVersion: 'v0.5.1',
  baseUrl: base,
  generatedAt: new Date().toISOString(),
  pass: !failed,
  checks: results,
  summary: {
    total: results.length,
    passed: results.filter(x => x.ok).length,
    failed: results.filter(x => !x.ok).length
  }
};

await fs.writeFile(out, JSON.stringify(report, null, 2));
console.log(`Smoke report: ${out}`);
console.log(`VERDICT: ${report.pass ? 'PASS' : 'FAIL'}`);

if (failed) process.exit(1);
