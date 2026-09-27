import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchScoreboard, fetchSummary, parseGameSummary, parseScoreboard } from './lib/espn.js';
import { evaluateFourthDown, gradeActualDecision, evaluateThirdDownPlanning } from './lib/decision-engine.js';
import { fetchNfl4thBenchmarkState } from './lib/benchmark.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');

const RELEASE_VERSION = 'v0.5.1';
const RELEASE_STATUS = 'PROMOTED';
const RELEASE_AUDIT = 'PROMOTE';
const ENGINE_VERSION = 'v0.5-endgame-intelligence';
const EVALUATED_CANDIDATE_COMMIT = '8daaa8f75787e4f28d25af6462142518f4594e9a';

const scoreboardCache = { at: 0, data: null };
const summaryCache = new Map();

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
};

const staticTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const stampRelease = value => (
  value && typeof value === 'object'
    ? {
        ...value,
        releaseVersion: RELEASE_VERSION,
        releaseStatus: RELEASE_STATUS
      }
    : value
);

async function getScoreboardCached(maxAgeMs = 10000) {
  if (scoreboardCache.data && Date.now() - scoreboardCache.at < maxAgeMs) return scoreboardCache.data;
  const raw = await fetchScoreboard();
  const parsed = parseScoreboard(raw);
  scoreboardCache.at = Date.now();
  scoreboardCache.data = parsed;
  return parsed;
}

async function getSummaryCached(id, maxAgeMs = 4000) {
  const hit = summaryCache.get(id);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const raw = await fetchSummary(id);
  summaryCache.set(id, { at: Date.now(), data: raw });
  return raw;
}

function inferNflverseGameId(raw) {
  const header = raw?.header || {};
  const comp = header?.competitions?.[0] || {};
  const competitors = comp?.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  const homeAbbr = home?.team?.abbreviation;
  const awayAbbr = away?.team?.abbreviation;
  const year = Number(header?.season?.year ?? raw?.season?.year ?? header?.season);
  const week = Number(header?.week?.number ?? header?.week ?? raw?.week?.number ?? raw?.week ?? comp?.week?.number);
  if (!Number.isFinite(year) || !Number.isFinite(week) || !homeAbbr || !awayAbbr) return null;
  return `${year}_${String(Math.trunc(week)).padStart(2, '0')}_${awayAbbr}_${homeAbbr}`;
}

function enrichGame(raw) {
  const game = parseGameSummary(raw);
  if (game.pendingFourthDown?.yardline100) {
    game.pendingFourthDown.evaluation = stampRelease(evaluateFourthDown(game.pendingFourthDown));
  }
  if (game.pendingThirdDown?.yardline100) {
    game.pendingThirdDown.planning = evaluateThirdDownPlanning(game.pendingThirdDown);
  }
  game.completedFourthDowns = (game.completedFourthDowns || []).map(d => {
    if (!d.verifiedState || !d.yardline100 || !Number.isFinite(Number(d.ydstogo))) {
      return { ...d, grade: 'REVIEW', wpRegret: null, reason: d.fieldPositionConflict || 'insufficient-feed-fields' };
    }
    const ev = evaluateFourthDown({ ...d, indoor: game.indoor, baselineWp: d.baselineWp });
    return { ...d, ...gradeActualDecision(ev, d.actualDecision), releaseVersion: RELEASE_VERSION };
  });
  return game;
}

async function getLiveBoard() {
  const games = await getScoreboardCached();
  const active = games.filter(g => String(g.state).toLowerCase() === 'in');
  const trackable = games.filter(g => ['in', 'post'].includes(String(g.state).toLowerCase()));
  const enriched = [];

  const results = await Promise.allSettled(trackable.map(async g => {
    const ttl = String(g.state).toLowerCase() === 'in' ? 4000 : 60000;
    return enrichGame(await getSummaryCached(g.id, ttl));
  }));
  for (const r of results) if (r.status === 'fulfilled') enriched.push(r.value);

  const pendingFourthDowns = enriched
    .filter(g => String(g.state).toLowerCase() === 'in' && g.pendingFourthDown?.evaluation)
    .map(g => ({ eventId: g.eventId, gameName: g.name, ...g.pendingFourthDown }));

  const twoDownAlerts = enriched
    .filter(g => String(g.state).toLowerCase() === 'in' && g.pendingThirdDown?.planning?.twoDownTerritory)
    .map(g => ({ eventId: g.eventId, gameName: g.name, ...g.pendingThirdDown }));

  const ledger = enriched
    .flatMap(g => (g.completedFourthDowns || []).map(d => ({ eventId: g.eventId, gameName: g.name, ...d })))
    .filter(d => d.actualDecision);

  return {
    generatedAt: new Date().toISOString(),
    source: 'espn-live-adapter',
    releaseVersion: RELEASE_VERSION,
    games,
    activeGameCount: active.length,
    pendingFourthDowns,
    twoDownAlerts,
    ledger
  };
}

async function api(req, res, url) {
  if (url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      releaseVersion: RELEASE_VERSION,
      releaseStatus: RELEASE_STATUS,
      releaseAudit: RELEASE_AUDIT,
      modelVersion: 'v0.5.1-gated-endgame',
      engineVersion: ENGINE_VERSION,
      calibrationVersion: 'v0.4.1',
      evaluatedCandidateCommit: EVALUATED_CANDIDATE_COMMIT,
      deployCommit: process.env.RENDER_GIT_COMMIT || null,
      now: new Date().toISOString()
    });
  }

  if (url.pathname === '/api/scoreboard') {
    try {
      return json(res, 200, { source: 'espn-live-adapter', releaseVersion: RELEASE_VERSION, games: await getScoreboardCached() });
    } catch (e) {
      return json(res, 502, { error: 'LIVE_FEED_UNAVAILABLE', message: e.message });
    }
  }

  if (url.pathname === '/api/live') {
    try {
      return json(res, 200, await getLiveBoard());
    } catch (e) {
      return json(res, 502, { error: 'LIVE_BOARD_UNAVAILABLE', message: e.message });
    }
  }

  if (url.pathname.startsWith('/api/benchmark/')) {
    const id = url.pathname.split('/').pop();
    try {
      let expectedGameId = null;
      try {
        expectedGameId = inferNflverseGameId(await getSummaryCached(id, 60000));
      } catch {}
      const state = await fetchNfl4thBenchmarkState(id, expectedGameId, 30_000);
      return json(res, 200, { eventId: id, nflverseGameId: expectedGameId, releaseVersion: RELEASE_VERSION, ...state });
    } catch (e) {
      return json(res, 502, {
        available: false,
        eventId: id,
        releaseVersion: RELEASE_VERSION,
        error: 'BENCHMARK_UNAVAILABLE',
        status: { code: 'PIPELINE_ERROR', label: 'PIPELINE ERROR', message: e.message }
      });
    }
  }

  if (url.pathname.startsWith('/api/game/')) {
    const id = url.pathname.split('/').pop();
    try {
      const raw = await getSummaryCached(id, 2500);
      return json(res, 200, { source: 'espn-live-adapter', releaseVersion: RELEASE_VERSION, game: enrichGame(raw) });
    } catch (e) {
      return json(res, 502, { error: 'GAME_FEED_UNAVAILABLE', message: e.message });
    }
  }

  if (url.pathname === '/api/evaluate' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const input = JSON.parse(body || '{}');
      const evaluation = evaluateFourthDown(input);
      const result = input.actualDecision ? gradeActualDecision(evaluation, input.actualDecision) : evaluation;
      return json(res, 200, stampRelease(result));
    } catch (e) {
      return json(res, 400, { error: 'BAD_INPUT', message: e.message });
    }
  }

  if (url.pathname === '/api/evaluate-third' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      return json(res, 200, {
        ...evaluateThirdDownPlanning(JSON.parse(body || '{}')),
        releaseVersion: RELEASE_VERSION
      });
    } catch (e) {
      return json(res, 400, { error: 'BAD_INPUT', message: e.message });
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const handled = await api(req, res, url);
    if (handled !== false) return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(pathname).replace(/^\.\.(\/|\\|$)/, '');
  const file = path.join(publicDir, safePath);
  if (!file.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'content-type': staticTypes[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    try {
      const buf = await fs.readFile(path.join(publicDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`4TH DOWN v0.5.1 running on http://localhost:${PORT}`));
