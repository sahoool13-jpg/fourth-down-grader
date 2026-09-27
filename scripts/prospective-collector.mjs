import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RELEASE_START_AT,
  RELEASE_TAG,
  EVALUATED_CANDIDATE_COMMIT,
  finite,
  isProspectiveEligibleGame,
  stableRecordId,
  inputFromLedger,
  snapshotEvaluation,
  makeSnapshotHash,
  matchBenchmarkRows,
  buildReferenceMatch,
  buildSummary
} from './prospective-lib.mjs';

const BASE_URL = String(process.env.PRODUCTION_BASE_URL || 'https://fourth-down-grader.onrender.com').replace(/\/+$/, '');
const DATA_DIR = path.resolve('data/prospective/2026');
const DATA_PATH = path.join(DATA_DIR, 'decisions.json');
const POLICY_PATH = path.join(DATA_DIR, 'policy.json');
const SUMMARY_PATH = path.join(DATA_DIR, 'summary.json');
const FORCE = String(process.env.PROSPECTIVE_FORCE || '').toLowerCase() === 'true';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function fetchJson(url, options = {}, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, {
        ...options,
        headers: {
          'user-agent': 'FourthDownProspectiveMonitor/0.1',
          'accept': 'application/json',
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(30000)
      });
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      if (r.ok) return body;
      last = new Error(`${r.status} ${url}: ${text.slice(0, 500)}`);
    } catch (e) {
      last = e;
    }
    if (i < attempts) await sleep(i * 7000);
  }
  throw last || new Error(`Failed ${url}`);
}

function inSeasonWindow() {
  const month = new Date().getUTCMonth() + 1;
  return month >= 8 || month <= 2;
}

function cleanTeam(t = {}) {
  return {
    id: t?.id != null ? String(t.id) : null,
    abbreviation: t?.abbreviation || null,
    name: t?.name || null
  };
}

function materialModelSnapshot(row) {
  return snapshotEvaluation({
    ...row,
    actual: row.actual || row.actualDecision
  });
}

function makeRecord(row, game, health, legacy) {
  const id = stableRecordId(row);
  const record = {
    schemaVersion: 1,
    id,
    season: 2026,
    capturedAt: new Date().toISOString(),
    release: {
      tag: RELEASE_TAG,
      releaseVersion: health.releaseVersion,
      releaseStatus: health.releaseStatus,
      evaluatedCandidateCommit: health.evaluatedCandidateCommit,
      deployCommit: health.deployCommit || null
    },
    game: {
      eventId: String(row.eventId || game.id || ''),
      name: row.gameName || game.name || null,
      kickoff: game.date || null,
      stateAtCapture: game.state || null
    },
    offense: cleanTeam(row.offense),
    defense: cleanTeam(row.defense),
    state: {
      quarter: finite(row.quarter),
      clock: row.clock || null,
      secondsRemaining: finite(row.secondsRemaining),
      ydstogo: finite(row.ydstogo),
      yardline100: finite(row.yardline100),
      fieldPositionText: row.fieldPositionText || null,
      scoreDiff: finite(row.scoreDiff),
      scoreText: row.scoreText || null,
      timeouts: finite(row.timeouts),
      opponentTimeouts: finite(row.opponentTimeouts),
      baselineWp: finite(row.baselineWp),
      indoor: Boolean(row.indoor)
    },
    decision: {
      playId: row.id != null ? String(row.id) : null,
      actual: String(row.actualDecision || row.actual || '').toUpperCase() || null,
      situationText: row.situationText || null
    },
    model: {
      v051: materialModelSnapshot(row),
      legacy: snapshotEvaluation(legacy)
    },
    outcome: {
      text: row.description || null
    },
    integrity: {
      verifiedState: Boolean(row.verifiedState),
      possessionSource: row.possessionSource || null,
      fieldPositionSource: row.fieldPositionSource || row.yardlineSource || null,
      fieldPositionConflict: row.fieldPositionConflict || null,
      numericConflict: row.numericConflict || null,
      sourceConflict: row.sourceConflict || null
    },
    referencePipeline: {
      code: 'PENDING',
      label: 'PENDING'
    },
    reference: null
  };
  record.snapshotHash = makeSnapshotHash(record);
  return record;
}

function benchmarkEnvelope(payload) {
  if (payload?.benchmark) {
    return {
      rows: Array.isArray(payload.benchmark.rows) ? payload.benchmark.rows : [],
      status: payload.status || payload.benchmark.pipeline_status || { code: 'READY', label: 'READY' }
    };
  }
  if (Array.isArray(payload?.rows)) {
    return { rows: payload.rows, status: payload.status || payload.pipeline_status || { code: 'READY', label: 'READY' } };
  }
  return {
    rows: [],
    status: payload?.status || { code: payload?.error || 'GAME_NOT_FOUND', label: payload?.status?.label || payload?.error || 'GAME NOT FOUND', message: payload?.message || null }
  };
}

async function gradeLegacy(row) {
  return fetchJson(`${BASE_URL}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(inputFromLedger(row, false))
  });
}

async function enrichReferences(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.game.eventId)) groups.set(r.game.eventId, []);
    groups.get(r.game.eventId).push(r);
  }

  let changed = false;

  for (const [eventId, gameRecords] of groups) {
    let env;
    try {
      env = benchmarkEnvelope(await fetchJson(`${BASE_URL}/api/benchmark/${encodeURIComponent(eventId)}`, {}, 2));
    } catch (e) {
      env = { rows: [], status: { code: 'PIPELINE_ERROR', label: 'PIPELINE ERROR', message: e.message } };
    }

    const status = {
      code: String(env.status?.code || (env.rows.length ? 'READY' : 'GAME_NOT_FOUND')),
      label: String(env.status?.label || (env.rows.length ? 'READY' : 'GAME NOT FOUND')),
      message: env.status?.message || null
    };

    const matches = matchBenchmarkRows(gameRecords, env.rows);

    for (const record of gameRecords) {
      const oldPipeline = JSON.stringify(record.referencePipeline || {});
      record.referencePipeline = status;
      if (oldPipeline !== JSON.stringify(record.referencePipeline)) changed = true;

      const hit = matches.get(record.id);
      if (hit) {
        const next = buildReferenceMatch(hit.row, hit.method);
        if (JSON.stringify(record.reference) !== JSON.stringify(next)) {
          record.reference = next;
          changed = true;
        }
      } else if (env.rows.length && record.reference?.status !== 'MATCHED') {
        const next = { status: 'NO_MATCH' };
        if (JSON.stringify(record.reference) !== JSON.stringify(next)) {
          record.reference = next;
          changed = true;
        }
      }
    }
  }

  return changed;
}

async function main() {
  if (!FORCE && !inSeasonWindow()) {
    console.log('Outside Aug-Feb prospective season window. No-op.');
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const policy = await readJson(POLICY_PATH, null);
  if (!policy) throw new Error(`Missing policy file: ${POLICY_PATH}`);

  const store = await readJson(DATA_PATH, {
    schemaVersion: 1,
    season: 2026,
    monitorStartAt: RELEASE_START_AT,
    releaseTag: RELEASE_TAG,
    evaluatedCandidateCommit: EVALUATED_CANDIDATE_COMMIT,
    records: []
  });

  if (store.monitorStartAt !== RELEASE_START_AT) throw new Error('Prospective start boundary changed. Refusing to continue.');
  if (store.releaseTag !== RELEASE_TAG) throw new Error('Release tag changed. Refusing to continue.');
  if (store.evaluatedCandidateCommit !== EVALUATED_CANDIDATE_COMMIT) throw new Error('Evaluated candidate changed. Refusing to continue.');

  const health = await fetchJson(`${BASE_URL}/api/health`);
  if (health?.releaseVersion !== RELEASE_TAG ||
      health?.releaseStatus !== 'PROMOTED' ||
      health?.releaseAudit !== 'PROMOTE' ||
      health?.evaluatedCandidateCommit !== EVALUATED_CANDIDATE_COMMIT) {
    throw new Error(`Production identity mismatch: ${JSON.stringify(health)}`);
  }

  const live = await fetchJson(`${BASE_URL}/api/live`);
  const games = Array.isArray(live?.games) ? live.games : [];
  const gameMap = new Map(games.map(g => [String(g.id), g]));
  const eligibleGameIds = new Set(
    games.filter(g => isProspectiveEligibleGame(g, RELEASE_START_AT)).map(g => String(g.id))
  );

  const existing = new Map((store.records || []).map(r => [r.id, r]));
  let materialChange = false;
  let added = 0;

  const newRows = (live?.ledger || []).filter(row => {
    const eventId = String(row?.eventId || '');
    return eligibleGameIds.has(eventId);
  });

  for (const row of newRows) {
    const id = stableRecordId(row);
    if (existing.has(id)) continue;

    if (!row?.actualDecision) continue;
    const eventId = String(row.eventId || '');
    const game = gameMap.get(eventId);
    if (!game || !isProspectiveEligibleGame(game, RELEASE_START_AT)) continue;

    let legacy = {};
    try {
      legacy = await gradeLegacy(row);
    } catch (e) {
      legacy = { optimal: null, certainty: null, options: {}, grade: null, wpRegret: null, diagnostics: { legacyFetchError: e.message } };
    }

    const record = makeRecord(row, game, health, legacy);
    existing.set(record.id, record);
    materialChange = true;
    added++;
  }

  const records = [...existing.values()];
  const referenceChanged = await enrichReferences(records);
  if (referenceChanged) materialChange = true;

  const oldSummary = await readJson(SUMMARY_PATH, null);
  const lastMaterialUpdateAt = materialChange
    ? new Date().toISOString()
    : (oldSummary?.lastMaterialUpdateAt || null);

  const summary = buildSummary(records, policy, {
    lastMaterialUpdateAt,
    productionHealth: {
      releaseVersion: health.releaseVersion,
      releaseStatus: health.releaseStatus,
      releaseAudit: health.releaseAudit,
      evaluatedCandidateCommit: health.evaluatedCandidateCommit,
      deployCommit: health.deployCommit || null,
      bootState: health.bootState || null
    }
  });

  if (materialChange || !oldSummary) {
    store.records = records.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    await fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2) + '\n');
    await fs.writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n');
    console.log(`Material update: +${added} new decision(s), ${records.length} total archived.`);
  } else {
    console.log(`No material change. ${records.length} decision(s) already archived.`);
  }

  console.log(`Prospective status: ${summary.modelHealth.state}`);
  console.log(`Gradable: ${summary.sample.gradable}/${summary.maturity.totalGradableTarget}`);
  console.log(`Reference comparable: ${summary.sample.referenceComparable}/${summary.maturity.referenceComparableTarget}`);
}

await main();
