import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateFourthDown } from '../lib/decision-engine.js';
import { compareCalibrationRow, buildCalibrationSummary } from '../lib/calibration.js';

const referencePath = process.env.CALIBRATION_REFERENCE || '.calibration/reference.json';
const phase = String(process.env.V051_PHASE || 'development').toLowerCase();
const reportDir = 'public/calibration';
const outputBase = phase === 'holdout' ? 'v051-holdout' : 'v051-development';

const numericOrNull = x => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const raw = JSON.parse(await fs.readFile(referencePath, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw.rows;
const metadata = Array.isArray(raw) ? {} : (raw.metadata || {});
if (!Array.isArray(rows) || rows.length < 500) throw new Error(`Reference sample too small: ${rows?.length || 0}`);

const cleanSummary = comparisons => buildCalibrationSummary(comparisons, 9999).overall;

function stateInput(row) {
  return {
    ydstogo: Number(row.ydstogo),
    yardline100: Number(row.yardline_100),
    scoreDiff: Number(row.score_differential),
    secondsRemaining: Number(row.game_seconds_remaining),
    timeouts: Number(row.posteam_timeouts_remaining),
    opponentTimeouts: Number(row.defteam_timeouts_remaining),
    indoor: Boolean(row.indoor),
    baselineWp: numericOrNull(row.wp)
  };
}

const candidateRows = [];
const legacyRows = [];
const paired = [];
let skipped = 0;

for (const row of rows) {
  const input = stateInput(row);
  const candidateEval = evaluateFourthDown({ ...input, endgameEnabled: true });
  const legacyEval = evaluateFourthDown({ ...input, endgameEnabled: false });
  const candidate = compareCalibrationRow(row, candidateEval);
  const legacy = compareCalibrationRow(row, legacyEval);
  if (!candidate || !legacy) {
    skipped++;
    continue;
  }

  candidateRows.push(candidate);
  legacyRows.push(legacy);

  const cRegret = numericOrNull(candidate.referenceRegretPp);
  const lRegret = numericOrNull(legacy.referenceRegretPp);

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
    regretImprovementPp: cRegret != null && lRegret != null ? lRegret - cRegret : null,
    flipped: candidate.primaryOptimal !== legacy.primaryOptimal,
    candidateTags: candidateEval.diagnostics?.endgame?.tags || [],
    candidateShifts: candidateEval.diagnostics?.endgame?.logitShifts || {},
    candidateOptions: candidate.primaryOptions,
    legacyOptions: legacy.primaryOptions
  });
}

const candidate = cleanSummary(candidateRows);
const legacy = cleanSummary(legacyRows);
const endgameCandidateRows = candidateRows.filter(r => r.gameSecondsRemaining <= 300);
const endgameLegacyRows = legacyRows.filter(r => r.gameSecondsRemaining <= 300);
const finalTwoCandidateRows = candidateRows.filter(r => r.gameSecondsRemaining <= 120);
const finalTwoLegacyRows = legacyRows.filter(r => r.gameSecondsRemaining <= 120);

const endgame = {
  candidate: cleanSummary(endgameCandidateRows),
  legacy: cleanSummary(endgameLegacyRows),
  finalTwoCandidate: cleanSummary(finalTwoCandidateRows),
  finalTwoLegacy: cleanSummary(finalTwoLegacyRows)
};

function delta(a, b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : null;
}

const flips = paired.filter(r => r.flipped);
const beneficialFlips = flips.filter(r => Number.isFinite(r.regretImprovementPp) && r.regretImprovementPp > 0.01);
const harmfulFlips = flips.filter(r => Number.isFinite(r.regretImprovementPp) && r.regretImprovementPp < -0.01);
const neutralFlips = flips.length - beneficialFlips.length - harmfulFlips.length;

const comparableImprovements = paired.filter(r => Number.isFinite(r.regretImprovementPp));
const totalLegacyRegret = comparableImprovements.reduce((s, r) => s + r.legacyRegretPp, 0);
const totalCandidateRegret = comparableImprovements.reduce((s, r) => s + r.candidateRegretPp, 0);
const netReferenceRegretSavedPp = totalLegacyRegret - totalCandidateRegret;

const overallDelta = {
  exactAgreementPp: 100 * delta(candidate.exactAgreement, legacy.exactAgreement),
  decisionSafePp: 100 * delta(candidate.decisionSafeRate, legacy.decisionSafeRate),
  meanRegretPp: delta(candidate.meanReferenceRegretPp, legacy.meanReferenceRegretPp),
  strongSplitPp: 100 * delta(candidate.strongSplitRate, legacy.strongSplitRate)
};

const endgameDelta = {
  exactAgreementPp: 100 * delta(endgame.candidate.exactAgreement, endgame.legacy.exactAgreement),
  decisionSafePp: 100 * delta(endgame.candidate.decisionSafeRate, endgame.legacy.decisionSafeRate),
  meanRegretPp: delta(endgame.candidate.meanReferenceRegretPp, endgame.legacy.meanReferenceRegretPp),
  strongSplitPp: 100 * delta(endgame.candidate.strongSplitRate, endgame.legacy.strongSplitRate)
};

const finalTwoDelta = {
  exactAgreementPp: 100 * delta(endgame.finalTwoCandidate.exactAgreement, endgame.finalTwoLegacy.exactAgreement),
  decisionSafePp: 100 * delta(endgame.finalTwoCandidate.decisionSafeRate, endgame.finalTwoLegacy.decisionSafeRate),
  meanRegretPp: delta(endgame.finalTwoCandidate.meanReferenceRegretPp, endgame.finalTwoLegacy.meanReferenceRegretPp),
  strongSplitPp: 100 * delta(endgame.finalTwoCandidate.strongSplitRate, endgame.finalTwoLegacy.strongSplitRate)
};

const worstHarm = harmfulFlips.length ? Math.max(...harmfulFlips.map(r => Math.abs(r.regretImprovementPp))) : 0;

const criteria = phase === 'development' ? {
  endgameMeanRegretImproves: endgame.candidate.meanReferenceRegretPp < endgame.legacy.meanReferenceRegretPp,
  endgameStrongSplitsDoNotWorsen: endgame.candidate.strongSplitRate <= endgame.legacy.strongSplitRate + 0.0005,
  overallMeanRegretDoesNotWorsen: candidate.meanReferenceRegretPp <= legacy.meanReferenceRegretPp,
  overallDecisionSafeDoesNotWorsen: candidate.decisionSafeRate >= legacy.decisionSafeRate - 0.001,
  netReferenceRegretSavedPositive: netReferenceRegretSavedPp > 0,
  beneficialFlipsOutnumberHarmful: beneficialFlips.length >= harmfulFlips.length,
  catastrophicRegressionGuard: worstHarm < 10
} : {};
const gatePass = phase === 'development' ? Object.values(criteria).every(Boolean) : null;

const topGains = comparableImprovements.filter(r => r.regretImprovementPp > 0.01).sort((a,b) => b.regretImprovementPp - a.regretImprovementPp).slice(0, 80);
const topHarms = comparableImprovements.filter(r => r.regretImprovementPp < -0.01).sort((a,b) => a.regretImprovementPp - b.regretImprovementPp).slice(0, 80);

const report = {
  schemaVersion: 1,
  productVersion: 'v0.5.1',
  experiment: 'Gated Endgame Intelligence',
  phase,
  generatedAt: new Date().toISOString(),
  referenceMetadata: metadata,
  methodology: {
    reference: 'nfl4th',
    comparison: 'Same primary engine, v0.5.1 gated endgame ON vs legacy endgame OFF on identical states.',
    developmentPolicy: 'Automatic v0.5.1 run uses 2021-2024 only. No 2025 state is loaded in development mode.',
    holdoutPolicy: '2025 remains locked until the v0.5.1 development promotion gate passes.',
    endgameWindowSeconds: 300,
    strongInterventionWindowSeconds: 120
  },
  rowsScored: candidateRows.length,
  rowsSkipped: skipped,
  legacy,
  candidate,
  endgame,
  deltas: { overall: overallDelta, endgame: endgameDelta, finalTwo: finalTwoDelta },
  flips: {
    total: flips.length,
    beneficial: beneficialFlips.length,
    harmful: harmfulFlips.length,
    neutral: neutralFlips,
    netReferenceRegretSavedPp,
    worstHarmPp: worstHarm
  },
  promotionGate: phase === 'development' ? { status: gatePass ? 'PASS' : 'REVIEW', criteria } : null
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, `${outputBase}.json`), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(reportDir, `${outputBase}-splits.json`), JSON.stringify({ schemaVersion: 1, phase, generatedAt: report.generatedAt, topGains, topHarms }, null, 2));
await fs.writeFile(path.join(reportDir, `${outputBase}-status.json`), JSON.stringify({
  code: 'V051_EXPERIMENT_READY',
  phase,
  generatedAt: report.generatedAt,
  rowsScored: candidateRows.length,
  gateStatus: report.promotionGate?.status || null,
  candidateExact: candidate.exactAgreement,
  legacyExact: legacy.exactAgreement,
  candidateDecisionSafe: candidate.decisionSafeRate,
  legacyDecisionSafe: legacy.decisionSafeRate,
  candidateMeanRegretPp: candidate.meanReferenceRegretPp,
  legacyMeanRegretPp: legacy.meanReferenceRegretPp,
  candidateStrongSplitRate: candidate.strongSplitRate,
  legacyStrongSplitRate: legacy.strongSplitRate,
  endgameCandidateMeanRegretPp: endgame.candidate.meanReferenceRegretPp,
  endgameLegacyMeanRegretPp: endgame.legacy.meanReferenceRegretPp,
  finalTwoCandidateMeanRegretPp: endgame.finalTwoCandidate.meanReferenceRegretPp,
  finalTwoLegacyMeanRegretPp: endgame.finalTwoLegacy.meanReferenceRegretPp,
  flips: report.flips
}, null, 2));

console.log(`v0.5.1 ${phase} experiment complete: ${candidateRows.length} states`);
console.log(`Overall exact: legacy ${(100*legacy.exactAgreement).toFixed(2)}% -> v0.5.1 ${(100*candidate.exactAgreement).toFixed(2)}%`);
console.log(`Mean regret: legacy ${legacy.meanReferenceRegretPp.toFixed(3)} -> v0.5.1 ${candidate.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Endgame regret: legacy ${endgame.legacy.meanReferenceRegretPp.toFixed(3)} -> v0.5.1 ${endgame.candidate.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Net regret saved: ${netReferenceRegretSavedPp.toFixed(2)} pp`);
if (phase === 'development') console.log(`Promotion gate: ${report.promotionGate.status}`);
