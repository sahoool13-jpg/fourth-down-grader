const ACTIONS = ['GO', 'FG', 'PUNT'];

const finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const rms = (xs) => xs.length ? Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length) : null;

function quantile(values, p) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  const t = idx - lo;
  return xs[lo] * (1 - t) + xs[hi] * t;
}

export function optionsFromReference(row = {}) {
  return {
    GO: finite(row.go_wp),
    FG: finite(row.fg_wp),
    PUNT: finite(row.punt_wp)
  };
}

export function optionsFromEvaluation(ev = {}) {
  return Object.fromEntries(ACTIONS.map(a => [a, finite(ev?.options?.[a])]));
}

export function rankOptions(options = {}) {
  return ACTIONS
    .map(action => [action, finite(options[action])])
    .filter(([, wp]) => wp != null)
    .sort((a, b) => b[1] - a[1]);
}

export function certaintyFromEdgePp(edgePp) {
  if (!Number.isFinite(Number(edgePp))) return 'UNKNOWN';
  if (Number(edgePp) >= 2.0) return 'CLEAR';
  if (Number(edgePp) >= 0.75) return 'LEAN';
  return 'TOSS-UP';
}

function actionDistribution(rows, field) {
  const counts = Object.fromEntries(ACTIONS.map(a => [a, 0]));
  for (const row of rows) {
    const a = row[field];
    if (counts[a] != null) counts[a]++;
  }
  const n = rows.length || 1;
  return Object.fromEntries(ACTIONS.map(a => [a, {
    count: counts[a],
    share: counts[a] / n
  }]));
}

function optionErrorStats(comparisons, errorField = 'wpErrorsPp') {
  const out = {};
  for (const action of ACTIONS) {
    const vals = comparisons
      .map(r => r?.[errorField]?.[action])
      .filter(Number.isFinite);
    out[action] = {
      n: vals.length,
      maePp: mean(vals.map(Math.abs)),
      biasPp: mean(vals),
      rmsePp: rms(vals),
      p90AbsPp: quantile(vals.map(Math.abs), 0.90)
    };
  }
  return out;
}

function pairwiseStats(comparisons) {
  const pairs = ['GO_FG', 'GO_PUNT', 'FG_PUNT'];
  return Object.fromEntries(pairs.map(pair => {
    const vals = comparisons.map(r => r?.pairwiseMarginErrorsPp?.[pair]).filter(Number.isFinite);
    return [pair, {
      n: vals.length,
      maePp: mean(vals.map(Math.abs)),
      biasPp: mean(vals),
      rmsePp: rms(vals)
    }];
  }));
}

function summarizeCertainty(comparisons) {
  const levels = ['CLEAR', 'LEAN', 'TOSS-UP'];
  return Object.fromEntries(levels.map(level => {
    const rows = comparisons.filter(r => r.primaryCertainty === level);
    const regrets = rows.map(r => r.referenceRegretPp).filter(Number.isFinite);
    const exact = rows.filter(r => r.exact).length;
    const safe = rows.filter(r => r.decisionSafe).length;
    return [level, {
      n: rows.length,
      exactAgreement: rows.length ? exact / rows.length : null,
      decisionSafeRate: rows.length ? safe / rows.length : null,
      meanReferenceRegretPp: mean(regrets),
      p95ReferenceRegretPp: quantile(regrets, 0.95)
    }];
  }));
}

export function compareCalibrationRow(reference, evaluation, alternateEvaluations = {}) {
  const ref = optionsFromReference(reference);
  const primary = optionsFromEvaluation(evaluation);
  const refRank = rankOptions(ref);
  const primaryRank = rankOptions(primary);

  if (refRank.length < 2 || primaryRank.length < 2) return null;

  const referenceOptimal = refRank[0][0];
  const referenceOptimalWp = refRank[0][1];
  const referenceEdgePp = 100 * (refRank[0][1] - refRank[1][1]);
  const primaryOptimal = primaryRank[0][0];
  const primaryEdgePp = 100 * (primaryRank[0][1] - primaryRank[1][1]);

  const primaryWpInReference = ref[primaryOptimal];
  const unsupportedPrimary = primaryWpInReference == null;
  const referenceRegretPp = unsupportedPrimary
    ? null
    : Math.max(0, 100 * (referenceOptimalWp - primaryWpInReference));

  const actual = String(reference.actual_decision || '').toUpperCase();
  const actualWp = ref[actual];
  const coachRegretPp = actualWp == null
    ? null
    : Math.max(0, 100 * (referenceOptimalWp - actualWp));

  const wpErrorsPp = {};
  for (const action of ACTIONS) {
    wpErrorsPp[action] = ref[action] != null && primary[action] != null
      ? 100 * (primary[action] - ref[action])
      : null;
  }

  const pairwiseMarginErrorsPp = {};
  for (const [a, b] of [['GO','FG'], ['GO','PUNT'], ['FG','PUNT']]) {
    const key = `${a}_${b}`;
    pairwiseMarginErrorsPp[key] =
      ref[a] != null && ref[b] != null && primary[a] != null && primary[b] != null
        ? 100 * ((primary[a] - primary[b]) - (ref[a] - ref[b]))
        : null;
  }

  const alternateWpErrorsPp = {};
  for (const [name, ev] of Object.entries(alternateEvaluations || {})) {
    const opts = optionsFromEvaluation(ev);
    alternateWpErrorsPp[name] = Object.fromEntries(ACTIONS.map(action => [
      action,
      ref[action] != null && opts[action] != null ? 100 * (opts[action] - ref[action]) : null
    ]));
  }

  const exact = primaryOptimal === referenceOptimal;
  const decisionSafe = exact || (referenceRegretPp != null && referenceRegretPp <= 0.75);
  const materialSplit = !exact && (unsupportedPrimary || (referenceRegretPp != null && referenceRegretPp > 0.75));
  const strongSplit = !exact && (unsupportedPrimary || (referenceRegretPp != null && referenceRegretPp >= 2.0));

  return {
    season: Number(reference.season),
    week: finite(reference.week),
    seasonType: reference.season_type || null,
    gameId: reference.game_id,
    playId: reference.play_id,
    posteam: reference.posteam,
    defteam: reference.defteam,
    quarter: Number(reference.qtr),
    quarterSecondsRemaining: Number(reference.quarter_seconds_remaining),
    gameSecondsRemaining: Number(reference.game_seconds_remaining),
    ydstogo: Number(reference.ydstogo),
    yardline100: Number(reference.yardline_100),
    scoreDiff: Number(reference.score_differential),
    actual,
    description: reference.desc || '',
    referenceOptimal,
    referenceOptions: ref,
    referenceEdgePp,
    referenceCertainty: certaintyFromEdgePp(referenceEdgePp),
    primaryOptimal,
    primaryOptions: primary,
    primaryEdgePp,
    primaryCertainty: evaluation.certainty || certaintyFromEdgePp(primaryEdgePp),
    exact,
    decisionSafe,
    materialSplit,
    strongSplit,
    unsupportedPrimary,
    referenceRegretPp,
    coachRegretPp,
    coachExact: actual === referenceOptimal,
    wpErrorsPp,
    pairwiseMarginErrorsPp,
    alternateWpErrorsPp
  };
}

function summarizeRows(comparisons) {
  const n = comparisons.length;
  if (!n) return {
    n: 0,
    exactAgreement: null,
    decisionSafeRate: null,
    materialSplitRate: null,
    strongSplitRate: null,
    meanReferenceRegretPp: null
  };

  const regrets = comparisons.map(r => r.referenceRegretPp).filter(Number.isFinite);
  const coachRegrets = comparisons.map(r => r.coachRegretPp).filter(Number.isFinite);

  return {
    n,
    exactAgreement: comparisons.filter(r => r.exact).length / n,
    decisionSafeRate: comparisons.filter(r => r.decisionSafe).length / n,
    materialSplitRate: comparisons.filter(r => r.materialSplit).length / n,
    strongSplitRate: comparisons.filter(r => r.strongSplit).length / n,
    unsupportedPrimaryChoices: comparisons.filter(r => r.unsupportedPrimary).length,
    meanReferenceRegretPp: mean(regrets),
    medianReferenceRegretPp: quantile(regrets, 0.50),
    p90ReferenceRegretPp: quantile(regrets, 0.90),
    p95ReferenceRegretPp: quantile(regrets, 0.95),
    worstReferenceRegretPp: regrets.length ? Math.max(...regrets) : null,
    coachExactAgreement: comparisons.filter(r => r.coachExact).length / n,
    meanCoachRegretPp: mean(coachRegrets),
    primaryActionDistribution: actionDistribution(comparisons, 'primaryOptimal'),
    referenceActionDistribution: actionDistribution(comparisons, 'referenceOptimal'),
    optionWpError: optionErrorStats(comparisons),
    pairwiseMarginError: pairwiseStats(comparisons),
    certainty: summarizeCertainty(comparisons)
  };
}

function bucketSummary(comparisons, keyFn) {
  const groups = new Map();
  for (const row of comparisons) {
    const key = keyFn(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([bucket, rows]) => ({ bucket, ...summarizeRows(rows) }))
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket), undefined, { numeric: true }));
}

export function buildCalibrationSummary(comparisons, holdoutSeason) {
  const development = comparisons.filter(r => Number(r.season) !== Number(holdoutSeason));
  const holdout = comparisons.filter(r => Number(r.season) === Number(holdoutSeason));

  const altModes = ['structural', 'vegasAnchor'];
  const anchorComparison = {};
  anchorComparison.liveLike = optionErrorStats(comparisons);
  for (const mode of altModes) {
    const projected = comparisons.map(r => ({
      ...r,
      wpErrorsPp: r.alternateWpErrorsPp?.[mode] || {}
    }));
    anchorComparison[mode] = optionErrorStats(projected);
  }

  return {
    overall: summarizeRows(comparisons),
    development: summarizeRows(development),
    holdout: summarizeRows(holdout),
    anchorComparison,
    buckets: {
      season: bucketSummary(comparisons, r => String(r.season)),
      quarter: bucketSummary(comparisons, r => `Q${r.quarter}`),
      distance: bucketSummary(comparisons, r => {
        const d = r.ydstogo;
        if (d <= 1) return '1';
        if (d <= 3) return '2-3';
        if (d <= 6) return '4-6';
        if (d <= 10) return '7-10';
        return '11+';
      }),
      fieldPosition: bucketSummary(comparisons, r => {
        const y = r.yardline100;
        if (y >= 80) return 'Own 1-20';
        if (y >= 60) return 'Own 21-40';
        if (y >= 41) return 'Midfield band';
        if (y >= 21) return 'Opponent 40-21';
        return 'Red zone';
      }),
      scoreState: bucketSummary(comparisons, r => {
        const s = r.scoreDiff;
        if (s >= 9) return 'Leading 9+';
        if (s >= 1) return 'Leading 1-8';
        if (s === 0) return 'Tied';
        if (s >= -8) return 'Trailing 1-8';
        if (s >= -16) return 'Trailing 9-16';
        return 'Trailing 17+';
      }),
      clock: bucketSummary(comparisons, r => {
        if (r.quarter < 4) return `Q${r.quarter}`;
        const sec = r.quarterSecondsRemaining;
        if (sec <= 120) return 'Q4 ≤2:00';
        if (sec <= 300) return 'Q4 2:01-5:00';
        if (sec <= 600) return 'Q4 5:01-10:00';
        return 'Q4 >10:00';
      }),
      referenceCall: bucketSummary(comparisons, r => r.referenceOptimal),
      primaryCertainty: bucketSummary(comparisons, r => r.primaryCertainty)
    }
  };
}

export function selectWorstSplits(comparisons, limit = 100) {
  return comparisons
    .filter(r => !r.exact)
    .slice()
    .sort((a, b) => {
      if (a.unsupportedPrimary !== b.unsupportedPrimary) return a.unsupportedPrimary ? -1 : 1;
      return (b.referenceRegretPp ?? -1) - (a.referenceRegretPp ?? -1);
    })
    .slice(0, limit);
}
