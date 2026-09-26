const RAW_ROOT = 'https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/public/benchmarks';
const cache = new Map();

export async function fetchNfl4thBenchmark(eventId, maxAgeMs = 60_000) {
  const id = String(eventId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;

  const url = `${RAW_ROOT}/${encodeURIComponent(id)}.json?ts=${Date.now()}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'FourthDownGrader/0.3 (+nfl4th validation adapter)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(9000)
  });
  if (r.status === 404) {
    cache.set(id, { at: Date.now(), data: null });
    return null;
  }
  if (!r.ok) throw new Error(`Benchmark upstream ${r.status}`);
  const data = await r.json();
  cache.set(id, { at: Date.now(), data });
  return data;
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
