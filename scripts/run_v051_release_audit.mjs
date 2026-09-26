import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateFourthDown } from '../lib/decision-engine.js';
import { compareCalibrationRow, buildCalibrationSummary } from '../lib/calibration.js';

const REFERENCE_PATH = process.env.CALIBRATION_REFERENCE || '.calibration/reference.json';
const HOLDOUT_PATH = 'public/calibration/v051-holdout.json';
const DEVELOPMENT_PATH = 'public/calibration/v051-development.json';
const OUTPUT_JSON = 'public/calibration/v051-release-audit.json';
const OUTPUT_MD = 'public/calibration/v051-release-audit.md';

const BOOTSTRAP_REPS = Number(process.env.RELEASE_BOOTSTRAP_REPS || 10000);
const BOOTSTRAP_SEED = Number(process.env.RELEASE_BOOTSTRAP_SEED || 5102025);
const EPS = 1e-9;

const finite = x => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const pct = x => `${(100 * Number(x)).toFixed(2)}%`;
const pp = x => `${Number(x).toFixed(3)} pp`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

function mean(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function bootstrapMean(values, reps, seed) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return null;
  const rng = mulberry32(seed);
  const estimates = new Array(reps);
  const n = xs.length;

  for (let r = 0; r < reps; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += xs[Math.floor(rng() * n)];
    }
    estimates[r] = sum / n;
  }

  const estimate = mean(xs);
  const bootMean = mean(estimates);
  const se = Math.sqrt(mean(estimates.map(x => (x - bootMean) ** 2)));
  const positive = estimates.filter(x => x > 0).length / reps;
  const nonNegative = estimates.filter(x => x >= 0).length / reps;

  return {
    n,
    estimate,
    se,
    lower95: quantile(estimates, 0.025),
    median: quantile(estimates, 0.50),
    upper95: quantile(estimates, 0.975),
    probabilityPositive: positive,
    probabilityNonNegative: nonNegative,
    reps,
    seed
  };
}

function stateInput(row) {
  return {
    ydstogo: Number(row.ydstogo),
    yardline100: Number(row.yardline_100),
    scoreDiff: Number(row.score_differential),
    secondsRemaining: Number(row.game_seconds_remaining),
    timeouts: Number(row.posteam_timeouts_remaining),
    opponentTimeouts: Number(row.defteam_timeouts_remaining),
    indoor: Boolean(row.indoor),
    baselineWp: finite(row.wp)
  };
}

function metricClose(a, b, tol = 1e-8) {
  return Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Math.abs(Number(a) - Number(b)) <= tol;
}

function summarizePaired(rows) {
  return {
    n: rows.length,
    regretImprovement: bootstrapMean(
      rows.map(r => r.regretImprovementPp),
      BOOTSTRAP_REPS,
      BOOTSTRAP_SEED + 11
    ),
    exactAgreementDelta: bootstrapMean(
      rows.map(r => Number(r.candidate.exact) - Number(r.legacy.exact)),
      BOOTSTRAP_REPS,
      BOOTSTRAP_SEED + 23
    ),
    decisionSafeDelta: bootstrapMean(
      rows.map(r => Number(r.candidate.decisionSafe) - Number(r.legacy.decisionSafe)),
      BOOTSTRAP_REPS,
      BOOTSTRAP_SEED + 37
    ),
    strongSplitImprovement: bootstrapMean(
      rows.map(r => Number(r.legacy.strongSplit) - Number(r.candidate.strongSplit)),
      BOOTSTRAP_REPS,
      BOOTSTRAP_SEED + 51
    )
  };
}

const raw = JSON.parse(await fs.readFile(REFERENCE_PATH, 'utf8'));
const referenceRows = Array.isArray(raw) ? raw : raw.rows;
const referenceMetadata = Array.isArray(raw) ? {} : (raw.metadata || {});

if (!Array.isArray(referenceRows) || referenceRows.length < 500) {
  throw new Error(`Reference sample too small: ${referenceRows?.length || 0}`);
}

const seasons = [...new Set(referenceRows.map(r => Number(r.season)).filter(Number.isFinite))].sort();
if (seasons.length !== 1 || seasons[0] !== 2025) {
  throw new Error(`Release audit requires 2025-only reference rows; found [${seasons.join(', ')}]`);
}

const holdout = JSON.parse(await fs.readFile(HOLDOUT_PATH, 'utf8'));
const development = JSON.parse(await fs.readFile(DEVELOPMENT_PATH, 'utf8'));

if (development?.productVersion !== 'v0.5.1' ||
    development?.phase !== 'development' ||
    development?.promotionGate?.status !== 'PASS') {
  throw new Error('Development report is not the frozen v0.5.1 PASS candidate.');
}

if (holdout?.productVersion !== 'v0.5.1' || holdout?.phase !== 'holdout') {
  throw new Error('Committed holdout report is not v0.5.1 holdout output.');
}

const paired = [];
const candidateRows = [];
const legacyRows = [];
let skipped = 0;

for (const row of referenceRows) {
  const input = stateInput(row);
  const candidateEval = evaluateFourthDown({ ...input, endgameEnabled: true });
  const legacyEval = evaluateFourthDown({ ...input, endgameEnabled: false });

  const candidate = compareCalibrationRow(row, candidateEval);
  const legacy = compareCalibrationRow(row, legacyEval);

  if (!candidate || !legacy || !candidate.comparable || !legacy.comparable) {
    skipped++;
    continue;
  }

  const cRegret = finite(candidate.referenceRegretPp);
  const lRegret = finite(legacy.referenceRegretPp);
  if (cRegret == null || lRegret == null) {
    skipped++;
    continue;
  }

  candidateRows.push(candidate);
  legacyRows.push(legacy);

  paired.push({
    season: candidate.season,
    week: candidate.week,
    gameId: candidate.gameId,
    playId: candidate.playId,
    posteam: candidate.posteam,
    defteam: candidate.defteam,
    quarter: candidate.quarter,
    quarterSecondsRemaining: candidate.quarterSecondsRemaining,
    gameSecondsRemaining: candidate.gameSecondsRemaining,
    ydstogo: candidate.ydstogo,
    yardline100: candidate.yardline100,
    scoreDiff: candidate.scoreDiff,
    actual: candidate.actual,
    description: candidate.description,
    referenceOptimal: candidate.referenceOptimal,
    referenceOptions: candidate.referenceOptions,
    legacyOptimal: legacy.primaryOptimal,
    candidateOptimal: candidate.primaryOptimal,
    legacyRegretPp: lRegret,
    candidateRegretPp: cRegret,
    regretImprovementPp: lRegret - cRegret,
    flipped: candidate.primaryOptimal !== legacy.primaryOptimal,
    candidateTags: candidateEval.diagnostics?.endgame?.tags || [],
    candidateShifts: candidateEval.diagnostics?.endgame?.logitShifts || {},
    candidate,
    legacy
  });
}

const cleanSummary = rows => buildCalibrationSummary(rows, 9999).overall;
const recomputed = {
  legacy: cleanSummary(legacyRows),
  candidate: cleanSummary(candidateRows),
  endgameLegacy: cleanSummary(legacyRows.filter(r => r.gameSecondsRemaining <= 300)),
  endgameCandidate: cleanSummary(candidateRows.filter(r => r.gameSecondsRemaining <= 300)),
  finalTwoLegacy: cleanSummary(legacyRows.filter(r => r.gameSecondsRemaining <= 120)),
  finalTwoCandidate: cleanSummary(candidateRows.filter(r => r.gameSecondsRemaining <= 120))
};

const reproductionChecks = {
  rowsScored: paired.length === holdout.rowsScored,
  legacyExact: metricClose(recomputed.legacy.exactAgreement, holdout.legacy.exactAgreement),
  candidateExact: metricClose(recomputed.candidate.exactAgreement, holdout.candidate.exactAgreement),
  legacyDecisionSafe: metricClose(recomputed.legacy.decisionSafeRate, holdout.legacy.decisionSafeRate),
  candidateDecisionSafe: metricClose(recomputed.candidate.decisionSafeRate, holdout.candidate.decisionSafeRate),
  legacyMeanRegret: metricClose(recomputed.legacy.meanReferenceRegretPp, holdout.legacy.meanReferenceRegretPp),
  candidateMeanRegret: metricClose(recomputed.candidate.meanReferenceRegretPp, holdout.candidate.meanReferenceRegretPp),
  legacyStrongSplit: metricClose(recomputed.legacy.strongSplitRate, holdout.legacy.strongSplitRate),
  candidateStrongSplit: metricClose(recomputed.candidate.strongSplitRate, holdout.candidate.strongSplitRate),
  endgameLegacyMeanRegret: metricClose(recomputed.endgameLegacy.meanReferenceRegretPp, holdout.endgame.legacy.meanReferenceRegretPp),
  endgameCandidateMeanRegret: metricClose(recomputed.endgameCandidate.meanReferenceRegretPp, holdout.endgame.candidate.meanReferenceRegretPp),
  finalTwoLegacyMeanRegret: metricClose(recomputed.finalTwoLegacy.meanReferenceRegretPp, holdout.endgame.finalTwoLegacy.meanReferenceRegretPp),
  finalTwoCandidateMeanRegret: metricClose(recomputed.finalTwoCandidate.meanReferenceRegretPp, holdout.endgame.finalTwoCandidate.meanReferenceRegretPp)
};
const reproductionPass = Object.values(reproductionChecks).every(Boolean);

const overallRows = paired;
const endgameRows = paired.filter(r => r.gameSecondsRemaining <= 300);
const finalTwoRows = paired.filter(r => r.gameSecondsRemaining <= 120);
const finalMinuteRows = paired.filter(r => r.gameSecondsRemaining <= 60);

const bootstrap = {
  overall: summarizePaired(overallRows),
  endgame: summarizePaired(endgameRows),
  finalTwo: summarizePaired(finalTwoRows),
  finalMinute: summarizePaired(finalMinuteRows)
};

const flips = paired.filter(r => r.flipped);
const beneficial = flips
  .filter(r => r.regretImprovementPp > 0.01)
  .sort((a, b) => b.regretImprovementPp - a.regretImprovementPp);
const harmful = flips
  .filter(r => r.regretImprovementPp < -0.01)
  .sort((a, b) => a.regretImprovementPp - b.regretImprovementPp);
const neutral = flips.filter(r => Math.abs(r.regretImprovementPp) <= 0.01);

const transitionMap = {};
for (const r of flips) {
  const key = `${r.legacyOptimal}->${r.candidateOptimal}`;
  if (!transitionMap[key]) transitionMap[key] = { count: 0, netRegretSavedPp: 0 };
  transitionMap[key].count++;
  transitionMap[key].netRegretSavedPp += r.regretImprovementPp;
}

const tagMap = {};
for (const r of flips) {
  for (const tag of r.candidateTags || []) {
    if (!tagMap[tag]) tagMap[tag] = { count: 0, netRegretSavedPp: 0, harmful: 0, beneficial: 0 };
    tagMap[tag].count++;
    tagMap[tag].netRegretSavedPp += r.regretImprovementPp;
    if (r.regretImprovementPp > 0.01) tagMap[tag].beneficial++;
    if (r.regretImprovementPp < -0.01) tagMap[tag].harmful++;
  }
}

const watchlist = harmful.map(r => {
  const reasons = [];
  if (r.ydstogo >= 15) reasons.push('EXTREME_DISTANCE');
  if (r.yardline100 >= 60) reasons.push('OWN_TERRITORY');
  if (r.gameSecondsRemaining <= 120) reasons.push('FINAL_TWO_MINUTES');
  if ((r.candidateTags || []).includes('TRAILING_PUNT_SCARCITY')) reasons.push('PUNT_SCARCITY_TRIGGER');
  if ((r.candidateTags || []).includes('FG_DOES_NOT_TIE_OR_LEAD')) reasons.push('FG_DISCOUNT_TRIGGER');
  if ((r.candidateTags || []).includes('CONVERSION_CAN_SEAL')) reasons.push('SEAL_GAME_TRIGGER');
  return {
    gameId: r.gameId,
    playId: r.playId,
    posteam: r.posteam,
    defteam: r.defteam,
    gameSecondsRemaining: r.gameSecondsRemaining,
    ydstogo: r.ydstogo,
    yardline100: r.yardline100,
    scoreDiff: r.scoreDiff,
    legacyOptimal: r.legacyOptimal,
    candidateOptimal: r.candidateOptimal,
    referenceOptimal: r.referenceOptimal,
    regretDamagePp: -r.regretImprovementPp,
    tags: r.candidateTags,
    reasons,
    description: r.description
  };
});

const netSaved = paired.reduce((sum, r) => sum + r.regretImprovementPp, 0);
const worstHarm = harmful.length ? Math.max(...harmful.map(r => -r.regretImprovementPp)) : 0;
const maxCandidateRegret = recomputed.candidate.worstReferenceRegretPp;
const maxLegacyRegret = recomputed.legacy.worstReferenceRegretPp;

const criteria = {
  frozenResultReproduced: reproductionPass,
  overallMeanRegretImproves: recomputed.candidate.meanReferenceRegretPp < recomputed.legacy.meanReferenceRegretPp,
  overallRegretBootstrap95AboveZero: bootstrap.overall.regretImprovement.lower95 > 0,
  endgameMeanRegretImproves: recomputed.endgameCandidate.meanReferenceRegretPp < recomputed.endgameLegacy.meanReferenceRegretPp,
  endgameRegretBootstrap95AboveZero: bootstrap.endgame.regretImprovement.lower95 > 0,
  finalTwoMeanRegretImproves: recomputed.finalTwoCandidate.meanReferenceRegretPp < recomputed.finalTwoLegacy.meanReferenceRegretPp,
  finalTwoRegretBootstrap95AboveZero: bootstrap.finalTwo.regretImprovement.lower95 > 0,
  decisionSafeDoesNotWorsen: recomputed.candidate.decisionSafeRate >= recomputed.legacy.decisionSafeRate - 0.001,
  strongSplitsDoNotWorsen: recomputed.candidate.strongSplitRate <= recomputed.legacy.strongSplitRate + 0.0005,
  beneficialFlipsOutnumberHarmful: beneficial.length > harmful.length,
  positiveNetRegretSaved: netSaved > 0,
  noFivePointNewHarm: worstHarm < 5,
  tailRiskImproves: maxCandidateRegret <= maxLegacyRegret
};

const failedCriteria = Object.entries(criteria).filter(([, ok]) => !ok).map(([name]) => name);
let verdict = failedCriteria.length === 0 ? 'PROMOTE' : 'HOLD';

if (!reproductionPass) verdict = 'HOLD';

const report = {
  schemaVersion: 1,
  productVersion: 'v0.5.1',
  audit: 'Release Audit',
  generatedAt: new Date().toISOString(),
  verdict,
  reference: {
    seasons,
    rows: referenceRows.length,
    rowsScored: paired.length,
    skipped,
    metadata: referenceMetadata,
    expectedNfl4thVersion: '1.0.7',
    nfl4thVersionMatchesHoldout: String(referenceMetadata?.nfl4th_version || '') === String(holdout?.referenceMetadata?.nfl4th_version || '')
  },
  reproduction: {
    pass: reproductionPass,
    checks: reproductionChecks
  },
  pointEstimates: {
    overall: {
      legacyMeanRegretPp: recomputed.legacy.meanReferenceRegretPp,
      candidateMeanRegretPp: recomputed.candidate.meanReferenceRegretPp,
      legacyExactAgreement: recomputed.legacy.exactAgreement,
      candidateExactAgreement: recomputed.candidate.exactAgreement,
      legacyDecisionSafeRate: recomputed.legacy.decisionSafeRate,
      candidateDecisionSafeRate: recomputed.candidate.decisionSafeRate,
      legacyStrongSplitRate: recomputed.legacy.strongSplitRate,
      candidateStrongSplitRate: recomputed.candidate.strongSplitRate,
      legacyWorstRegretPp: maxLegacyRegret,
      candidateWorstRegretPp: maxCandidateRegret
    },
    endgame: {
      legacyMeanRegretPp: recomputed.endgameLegacy.meanReferenceRegretPp,
      candidateMeanRegretPp: recomputed.endgameCandidate.meanReferenceRegretPp
    },
    finalTwo: {
      legacyMeanRegretPp: recomputed.finalTwoLegacy.meanReferenceRegretPp,
      candidateMeanRegretPp: recomputed.finalTwoCandidate.meanReferenceRegretPp
    }
  },
  bootstrap,
  flips: {
    total: flips.length,
    beneficial: beneficial.length,
    harmful: harmful.length,
    neutral: neutral.length,
    netReferenceRegretSavedPp: netSaved,
    worstHarmPp: worstHarm,
    transitions: transitionMap,
    tags: tagMap,
    topBeneficial: beneficial.slice(0, 20).map(({ candidate, legacy, ...r }) => r),
    harmful: harmful.map(({ candidate, legacy, ...r }) => r),
    watchlist
  },
  releaseGate: {
    verdict,
    criteria,
    failedCriteria,
    note: 'Release gate audits a frozen candidate. It must not be used to tune v0.5.1 after seeing 2025.'
  }
};

function ciText(x, scale = 1) {
  return `${(scale*x.estimate).toFixed(3)} [${(scale*x.lower95).toFixed(3)}, ${(scale*x.upper95).toFixed(3)}]`;
}

const md = `# 4TH DOWN v0.5.1 Release Audit

**Verdict: ${verdict}**

Generated: ${report.generatedAt}

## Integrity
- 2025-only reference rows: **${referenceRows.length.toLocaleString()}**
- Recomputed comparable states: **${paired.length.toLocaleString()}**
- Saved holdout reproduction: **${reproductionPass ? 'PASS' : 'FAIL'}**
- nfl4th version: **${referenceMetadata?.nfl4th_version || 'unknown'}**
- Bootstrap: **${BOOTSTRAP_REPS.toLocaleString()} paired resamples**, deterministic seed ${BOOTSTRAP_SEED}

## Holdout performance
| Metric | Legacy | v0.5.1 | Direction |
|---|---:|---:|---|
| Exact agreement | ${pct(recomputed.legacy.exactAgreement)} | ${pct(recomputed.candidate.exactAgreement)} | ${recomputed.candidate.exactAgreement >= recomputed.legacy.exactAgreement ? 'better' : 'worse'} |
| Decision-safe | ${pct(recomputed.legacy.decisionSafeRate)} | ${pct(recomputed.candidate.decisionSafeRate)} | ${recomputed.candidate.decisionSafeRate >= recomputed.legacy.decisionSafeRate ? 'better' : 'worse'} |
| Mean regret | ${pp(recomputed.legacy.meanReferenceRegretPp)} | ${pp(recomputed.candidate.meanReferenceRegretPp)} | ${recomputed.candidate.meanReferenceRegretPp <= recomputed.legacy.meanReferenceRegretPp ? 'better' : 'worse'} |
| Strong splits | ${pct(recomputed.legacy.strongSplitRate)} | ${pct(recomputed.candidate.strongSplitRate)} | ${recomputed.candidate.strongSplitRate <= recomputed.legacy.strongSplitRate ? 'better' : 'worse'} |
| Worst regret | ${pp(maxLegacyRegret)} | ${pp(maxCandidateRegret)} | ${maxCandidateRegret <= maxLegacyRegret ? 'better' : 'worse'} |
| Endgame mean regret | ${pp(recomputed.endgameLegacy.meanReferenceRegretPp)} | ${pp(recomputed.endgameCandidate.meanReferenceRegretPp)} | ${recomputed.endgameCandidate.meanReferenceRegretPp <= recomputed.endgameLegacy.meanReferenceRegretPp ? 'better' : 'worse'} |
| Final-two mean regret | ${pp(recomputed.finalTwoLegacy.meanReferenceRegretPp)} | ${pp(recomputed.finalTwoCandidate.meanReferenceRegretPp)} | ${recomputed.finalTwoCandidate.meanReferenceRegretPp <= recomputed.finalTwoLegacy.meanReferenceRegretPp ? 'better' : 'worse'} |

## Paired bootstrap
Positive values favor v0.5.1.

| Slice | Mean regret saved, pp | 95% bootstrap CI | P(improvement > 0) |
|---|---:|---:|---:|
| Overall | ${bootstrap.overall.regretImprovement.estimate.toFixed(4)} | ${bootstrap.overall.regretImprovement.lower95.toFixed(4)} to ${bootstrap.overall.regretImprovement.upper95.toFixed(4)} | ${pct(bootstrap.overall.regretImprovement.probabilityPositive)} |
| Final 5 min | ${bootstrap.endgame.regretImprovement.estimate.toFixed(4)} | ${bootstrap.endgame.regretImprovement.lower95.toFixed(4)} to ${bootstrap.endgame.regretImprovement.upper95.toFixed(4)} | ${pct(bootstrap.endgame.regretImprovement.probabilityPositive)} |
| Final 2 min | ${bootstrap.finalTwo.regretImprovement.estimate.toFixed(4)} | ${bootstrap.finalTwo.regretImprovement.lower95.toFixed(4)} to ${bootstrap.finalTwo.regretImprovement.upper95.toFixed(4)} | ${pct(bootstrap.finalTwo.regretImprovement.probabilityPositive)} |
| Final 60 sec | ${bootstrap.finalMinute.regretImprovement.estimate.toFixed(4)} | ${bootstrap.finalMinute.regretImprovement.lower95.toFixed(4)} to ${bootstrap.finalMinute.regretImprovement.upper95.toFixed(4)} | ${pct(bootstrap.finalMinute.regretImprovement.probabilityPositive)} |

## Flip audit
- Total flips: **${flips.length}**
- Beneficial: **${beneficial.length}**
- Harmful: **${harmful.length}**
- Neutral: **${neutral.length}**
- Net reference regret saved: **${netSaved.toFixed(2)} pp**
- Worst new harm: **${worstHarm.toFixed(2)} pp**

### Harmful flips
${harmful.length ? harmful.map((r, i) =>
`${i+1}. **${r.gameId}** — ${r.posteam}, Q${r.quarter} ${Math.floor(r.quarterSecondsRemaining/60)}:${String(r.quarterSecondsRemaining%60).padStart(2,'0')}, 4th & ${r.ydstogo}, y100 ${r.yardline100}, diff ${r.scoreDiff}. ${r.legacyOptimal} → ${r.candidateOptimal}; reference ${r.referenceOptimal}; damage **${(-r.regretImprovementPp).toFixed(2)} pp**. Tags: ${(r.candidateTags || []).join(', ') || 'none'}.`
).join('\n') : 'None.'}

## Release gate
${Object.entries(criteria).map(([name, ok]) => `- ${ok ? '✅' : '❌'} ${name}`).join('\n')}

## Decision
**${verdict}**

${verdict === 'PROMOTE'
  ? 'The frozen v0.5.1 candidate cleared the release audit. Promote this exact candidate to production, then monitor prospectively without retuning it.'
  : 'Do not deploy. Investigate the failed release criteria without tuning directly to the 2025 holdout.'}
`;

await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
await fs.writeFile(OUTPUT_JSON, JSON.stringify(report, null, 2));
await fs.writeFile(OUTPUT_MD, md);

console.log('====================================================');
console.log('             v0.5.1 RELEASE AUDIT');
console.log('====================================================');
console.log(`Reference states: ${referenceRows.length}`);
console.log(`Reproduction:     ${reproductionPass ? 'PASS' : 'FAIL'}`);
console.log(`Overall regret:   ${recomputed.legacy.meanReferenceRegretPp.toFixed(3)} -> ${recomputed.candidate.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Endgame regret:   ${recomputed.endgameLegacy.meanReferenceRegretPp.toFixed(3)} -> ${recomputed.endgameCandidate.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Final-two regret: ${recomputed.finalTwoLegacy.meanReferenceRegretPp.toFixed(3)} -> ${recomputed.finalTwoCandidate.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Overall bootstrap 95% CI saved: ${bootstrap.overall.regretImprovement.lower95.toFixed(4)} to ${bootstrap.overall.regretImprovement.upper95.toFixed(4)} pp`);
console.log(`Endgame bootstrap 95% CI saved: ${bootstrap.endgame.regretImprovement.lower95.toFixed(4)} to ${bootstrap.endgame.regretImprovement.upper95.toFixed(4)} pp`);
console.log(`Final-two bootstrap 95% CI saved: ${bootstrap.finalTwo.regretImprovement.lower95.toFixed(4)} to ${bootstrap.finalTwo.regretImprovement.upper95.toFixed(4)} pp`);
console.log(`Flips:            ${beneficial.length} beneficial / ${harmful.length} harmful / ${neutral.length} neutral`);
console.log(`Worst new harm:   ${worstHarm.toFixed(2)} pp`);
console.log(`VERDICT:          ${verdict}`);
if (failedCriteria.length) console.log(`Failed: ${failedCriteria.join(', ')}`);
console.log('====================================================');

if (verdict !== 'PROMOTE') process.exitCode = 2;
