const ACTIONS = ['GO', 'FG', 'PUNT'];

// Important: null is not zero. nfl4th legitimately returns NA/null for options
// that its reference model does not price (for example, punts from some deep
// opponent-territory states). Coercing null through Number(null) creates a fake
// 0% WP and catastrophic phantom regret.
const finite = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
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

function unavailableReason(action, row = {}) {
  const y100 = finite(row.yardline_100);
  if (action === 'PUNT' && y100 != null && y100 <= 30) {
    return 'NFL4TH_PUNT_REFERENCE_OUTSIDE_SUPPORT_RANGE';
  }
  return 'NFL4TH_REFERENCE_OPTION_UNAVAILABLE';
}

export function referenceOptionIntegrity(row = {}) {
  const options = optionsFromReference(row);
  const availableActions = ACTIONS.filter(a => options[a] != null);
  const unavailableActions = ACTIONS.filter(a => options[a] == null);
  const genuineZeroActions = availableActions.filter(a => options[a] === 0);
  const unavailableReasons = Object.fromEntries(
    unavailableActions.map(action => [action, unavailableReason(action, row)])
  );
  return {
    options,
    availableActions,
    unavailableActions,
    unavailableReasons,
    genuineZeroActions,
    supportCount: availableActions.length,
    complete: availableActions.length === ACTIONS.length,
    partial: availableActions.length >= 2 && availableActions.length < ACTIONS.length,
    usable: availableActions.length >= 2
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
    const allRows = comparisons.filter(r => r.primaryCertainty === level);
    const rows = allRows.filter(r => r.comparable);
    const regrets = rows.map(r => r.referenceRegretPp).filter(Number.isFinite);
    const exact = rows.filter(r => r.exact === true).length;
    const safe = rows.filter(r => r.decisionSafe === true).length;
    return [level, {
      n: allRows.length,
      comparableN: rows.length,
      referenceGapCount: allRows.length - rows.length,
      exactAgreement: rows.length ? exact / rows.length : null,
      decisionSafeRate: rows.length ? safe / rows.length : null,
      meanReferenceRegretPp: mean(regrets),
      p95ReferenceRegretPp: quantile(regrets, 0.95)
    }];
  }));
}

export function compareCalibrationRow(reference, evaluation, alternateEvaluations = {}) {
  const integrity = referenceOptionIntegrity(reference);
  const ref = integrity.options;
  const primary = optionsFromEvaluation(evaluation);
  const refRank = rankOptions(ref);
  const primaryRank = rankOptions(primary);

  if (!integrity.usable || primaryRank.length < 2) return null;

  const referenceOptimal = refRank[0][0];
  const referenceOptimalWp = refRank[0][1];
  const referenceEdgePp = 100 * (refRank[0][1] - refRank[1][1]);
  const primaryOptimal = primaryRank[0][0];
  const primaryEdgePp = 100 * (primaryRank[0][1] - primaryRank[1][1]);

  const primaryWpInReference = ref[primaryOptimal];
  const primaryReferenceSupported = primaryWpInReference != null;
  const comparable = primaryReferenceSupported;
  const referenceRegretPp = comparable
    ? Math.max(0, 100 * (referenceOptimalWp - primaryWpInReference))
    : null;

  const actual = String(reference.actual_decision || '').toUpperCase();
  const actualWp = ref[actual];
  const coachComparable = actualWp != null;
  const coachRegretPp = coachComparable
    ? Math.max(0, 100 * (referenceOptimalWp - actualWp))
    : null;

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

  const exact = comparable ? primaryOptimal === referenceOptimal : null;
  const decisionSafe = comparable
    ? Boolean(exact || (referenceRegretPp != null && referenceRegretPp <= 0.75))
    : null;
  const materialSplit = comparable
    ? Boolean(!exact && referenceRegretPp != null && referenceRegretPp > 0.75)
    : null;
  const strongSplit = comparable
    ? Boolean(!exact && referenceRegretPp != null && referenceRegretPp >= 2.0)
    : null;

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
    referenceAvailableActions: integrity.availableActions,
    referenceUnavailableActions: integrity.unavailableActions,
    referenceUnavailableReasons: integrity.unavailableReasons,
    genuineZeroReferenceActions: integrity.genuineZeroActions,
    referenceSupportCount: integrity.supportCount,
    referenceComplete: integrity.complete,
    referencePartial: integrity.partial,
    referenceEdgePp,
    referenceCertainty: certaintyFromEdgePp(referenceEdgePp),
    primaryOptimal,
    primaryOptions: primary,
    primaryEdgePp,
    primaryCertainty: evaluation.certainty || certaintyFromEdgePp(primaryEdgePp),
    primaryReferenceSupported,
    comparable,
    exact,
    decisionSafe,
    materialSplit,
    strongSplit,
    unsupportedPrimary: !primaryReferenceSupported,
    referenceRegretPp,
    coachComparable,
    coachRegretPp,
    coachExact: coachComparable ? actual === referenceOptimal : null,
    wpErrorsPp,
    pairwiseMarginErrorsPp,
    alternateWpErrorsPp
  };
}

function summarizeRows(comparisons) {
  const n = comparisons.length;
  if (!n) return {
    n: 0,
    comparableN: 0,
    referenceCoverageRate: null,
    fullReferenceCoverageRate: null,
    exactAgreement: null,
    decisionSafeRate: null,
    materialSplitRate: null,
    strongSplitRate: null,
    meanReferenceRegretPp: null
  };

  const comparable = comparisons.filter(r => r.comparable);
  const complete = comparisons.filter(r => r.referenceComplete);
  const comparableComplete = complete.filter(r => r.comparable);
  const regrets = comparable.map(r => r.referenceRegretPp).filter(Number.isFinite);
  const coachRows = comparisons.filter(r => r.coachComparable);
  const coachRegrets = coachRows.map(r => r.coachRegretPp).filter(Number.isFinite);
  const genuineZeroOptionCount = comparisons.reduce((sum, r) => sum + (r.genuineZeroReferenceActions?.length || 0), 0);

  return {
    n,
    comparableN: comparable.length,
    referenceCoverageRate: comparable.length / n,
    completeReferenceN: complete.length,
    fullReferenceCoverageRate: complete.length / n,
    partialReferenceN: comparisons.filter(r => r.referencePartial).length,
    referenceGapCount: n - comparable.length,
    referenceGapRate: (n - comparable.length) / n,
    genuineZeroOptionCount,
    exactAgreement: comparable.length ? comparable.filter(r => r.exact === true).length / comparable.length : null,
    exactAgreementCompleteOnly: comparableComplete.length
      ? comparableComplete.filter(r => r.exact === true).length / comparableComplete.length
      : null,
    decisionSafeRate: comparable.length ? comparable.filter(r => r.decisionSafe === true).length / comparable.length : null,
    decisionSafeCompleteOnly: comparableComplete.length
      ? comparableComplete.filter(r => r.decisionSafe === true).length / comparableComplete.length
      : null,
    materialSplitRate: comparable.length ? comparable.filter(r => r.materialSplit === true).length / comparable.length : null,
    strongSplitRate: comparable.length ? comparable.filter(r => r.strongSplit === true).length / comparable.length : null,
    unsupportedPrimaryChoices: comparisons.filter(r => !r.primaryReferenceSupported).length,
    meanReferenceRegretPp: mean(regrets),
    medianReferenceRegretPp: quantile(regrets, 0.50),
    p90ReferenceRegretPp: quantile(regrets, 0.90),
    p95ReferenceRegretPp: quantile(regrets, 0.95),
    worstReferenceRegretPp: regrets.length ? Math.max(...regrets) : null,
    coachComparableN: coachRows.length,
    coachExactAgreement: coachRows.length ? coachRows.filter(r => r.coachExact === true).length / coachRows.length : null,
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
      primaryCertainty: bucketSummary(comparisons, r => r.primaryCertainty),
      referenceIntegrity: bucketSummary(comparisons, r => r.referenceComplete ? 'Complete 3-option' : 'Partial reference')
    }
  };
}

export function selectWorstSplits(comparisons, limit = 100) {
  return comparisons
    .filter(r => r.comparable && r.exact === false && Number.isFinite(r.referenceRegretPp))
    .slice()
    .sort((a, b) => b.referenceRegretPp - a.referenceRegretPp)
    .slice(0, limit);
}

export function selectReferenceGaps(comparisons, limit = 100) {
  return comparisons
    .filter(r => !r.comparable)
    .slice()
    .sort((a, b) => {
      if (a.referenceSupportCount !== b.referenceSupportCount) return a.referenceSupportCount - b.referenceSupportCount;
      if (a.season !== b.season) return b.season - a.season;
      return String(a.gameId).localeCompare(String(b.gameId));
    })
    .slice(0, limit);
}
