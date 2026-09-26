const RAW_ROOT = 'https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/public/benchmarks';
const benchmarkCache = new Map();
let statusCache = null;

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'FourthDownGrader/0.3.1 (+nfl4th validation adapter)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(9000)
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Benchmark upstream ${r.status}`);
  return r.json();
}

export async function fetchNfl4thBenchmark(eventId, maxAgeMs = 60_000) {
  const id = String(eventId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  const hit = benchmarkCache.get(id);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;

  const data = await fetchJson(`${RAW_ROOT}/${encodeURIComponent(id)}.json?ts=${Date.now()}`);
  benchmarkCache.set(id, { at: Date.now(), data });
  return data;
}

export async function fetchNfl4thPipelineStatus(maxAgeMs = 60_000) {
  if (statusCache && Date.now() - statusCache.at < maxAgeMs) return statusCache.data;
  const data = await fetchJson(`${RAW_ROOT}/_status.json?ts=${Date.now()}`);
  statusCache = { at: Date.now(), data };
  return data;
}

export function normalizeBenchmarkStatus(status, { eventId = null, expectedGameId = null } = {}) {
  if (!status) {
    return {
      code: 'GAME_NOT_FOUND',
      label: 'GAME NOT FOUND',
      message: 'No nfl4th benchmark file or pipeline status exists for this game yet.',
      eventId
    };
  }

  if (expectedGameId && status.game_id && String(status.game_id) !== String(expectedGameId)) {
    return {
      code: 'GAME_NOT_FOUND',
      label: 'GAME NOT FOUND',
      message: `Latest nfl4th pipeline status is for ${status.game_id}, not ${expectedGameId}.`,
      eventId,
      expectedGameId,
      latestGameId: status.game_id
    };
  }

  const allowed = new Set(['BENCHMARK_READY', 'DATA_NOT_YET_AVAILABLE', 'GAME_NOT_FOUND', 'PIPELINE_ERROR']);
  const code = allowed.has(status.code) ? status.code : 'PIPELINE_ERROR';
  const fallbackLabel = code === 'BENCHMARK_READY'
    ? 'BENCHMARK READY'
    : code === 'DATA_NOT_YET_AVAILABLE'
      ? `${status.season || 'CURRENT-SEASON'} DATA NOT YET AVAILABLE`
      : code === 'GAME_NOT_FOUND'
        ? 'GAME NOT FOUND'
        : 'PIPELINE ERROR';

  return {
    ...status,
    code,
    label: status.label || fallbackLabel,
    eventId
  };
}

export async function fetchNfl4thBenchmarkState(eventId, expectedGameId = null, maxAgeMs = 60_000) {
  const id = String(eventId || '').trim();
  const benchmark = await fetchNfl4thBenchmark(id, maxAgeMs);
  if (benchmark?.rows?.length) {
    return {
      available: true,
      benchmark,
      status: normalizeBenchmarkStatus({
        code: 'BENCHMARK_READY',
        label: 'BENCHMARK READY',
        game_id: benchmark.game_id || expectedGameId,
        espn_id: benchmark.espn_id || id,
        generated_at: benchmark.generated_at,
        row_count: benchmark.rows.length,
        message: `Loaded ${benchmark.rows.length} nfl4th fourth-down states.`
      }, { eventId: id, expectedGameId })
    };
  }

  const pipelineStatus = await fetchNfl4thPipelineStatus(maxAgeMs);
  return {
    available: false,
    benchmark: null,
    status: normalizeBenchmarkStatus(pipelineStatus, { eventId: id, expectedGameId })
  };
}

export function summarizeBenchmarkAgreement(rows = [], benchmark = null) {
  if (!benchmark?.rows?.length) return {
    available: false,
    matched: 0,
    eligible: 0,
    exactAgreement: null,
    strongSplits: 0
  };

  const byId = new Map(benchmark.rows.map(r => [String(r.play_id), r]));
  let matched = 0;
  let eligible = 0;
  let agrees = 0;
  let strongSplits = 0;

  for (const row of rows) {
    const b = byId.get(String(row.id));
    if (!b) continue;
    matched++;
    if (!row.optimal || !b.optimal) continue;
    eligible++;
    if (String(row.optimal).toUpperCase() === String(b.optimal).toUpperCase()) agrees++;
    else if (b.certainty !== 'TOSS-UP' && row.certainty !== 'TOSS-UP') strongSplits++;
  }

  return {
    available: true,
    matched,
    eligible,
    exactAgreement: eligible ? agrees / eligible : null,
    strongSplits,
    generatedAt: benchmark.generated_at || null,
    source: benchmark.source || 'nfl4th'
  };
}
