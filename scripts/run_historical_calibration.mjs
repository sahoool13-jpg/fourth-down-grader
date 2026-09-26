import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateFourthDown } from '../lib/decision-engine.js';
import {
  compareCalibrationRow,
  buildCalibrationSummary,
  selectWorstSplits,
  selectReferenceGaps
} from '../lib/calibration.js';

const referencePath = process.env.CALIBRATION_REFERENCE || '.calibration/reference.json';
const reportDir = 'public/calibration';
const holdoutEnv = Number(process.env.HOLDOUT_SEASON || NaN);

const numericOrNull = x => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const raw = JSON.parse(await fs.readFile(referencePath, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw.rows;
const metadata = Array.isArray(raw) ? {} : (raw.metadata || {});
const holdoutSeason = Number.isFinite(holdoutEnv)
  ? holdoutEnv
  : Number(metadata.holdout_season || metadata.end_season);

if (!Array.isArray(rows) || !rows.length) {
  throw new Error('Calibration reference has no rows');
}

const comparisons = [];
let skipped = 0;

for (const row of rows) {
  const input = {
    ydstogo: Number(row.ydstogo),
    yardline100: Number(row.yardline_100),
    scoreDiff: Number(row.score_differential),
    secondsRemaining: Number(row.game_seconds_remaining),
    timeouts: Number(row.posteam_timeouts_remaining),
    opponentTimeouts: Number(row.defteam_timeouts_remaining),
    indoor: Boolean(row.indoor)
  };

  const liveLike = evaluateFourthDown({
    ...input,
    baselineWp: numericOrNull(row.wp)
  });

  const structural = evaluateFourthDown({ ...input, baselineWp: null });
  const vegasAnchor = evaluateFourthDown({
    ...input,
    baselineWp: numericOrNull(row.vegas_wp)
  });

  const comparison = compareCalibrationRow(row, liveLike, { structural, vegasAnchor });
  if (!comparison) {
    skipped++;
    continue;
  }
  comparisons.push(comparison);
}

if (comparisons.length < 1000) {
  throw new Error(`Only ${comparisons.length} usable fourth-down states`);
}

const summary = buildCalibrationSummary(comparisons, holdoutSeason);
const splits = selectWorstSplits(comparisons, 120);
const referenceGaps = selectReferenceGaps(comparisons, 120);

const report = {
  schemaVersion: 2,
  productVersion: 'v0.4.1',
  modelCore: 'v0.3.2 anchored-counterfactual',
  generatedAt: new Date().toISOString(),
  methodology: {
    reference: 'nfl4th',
    referenceFunction: 'nfl4th::load_4th_pbp(fast = FALSE)',
    primary: '4TH DOWN anchored-counterfactual model',
    headlineMetric: 'Reference regret: nfl4th optimal WP minus nfl4th WP of the primary model choice, only when nfl4th prices the primary action.',
    decisionSafeThresholdPp: 0.75,
    strongSplitThresholdPp: 2.0,
    holdoutSeason,
    referenceIntegrity: 'Null/NA reference probabilities are unavailable actions, not 0% WP. Genuine numeric zeros remain valid. Rows where the primary action is unavailable in nfl4th are reported as reference gaps and excluded from regret/split denominators.',
    note: 'nfl4th is a validation reference, not ground truth. The holdout season is reported separately to discourage tuning to the full sample.'
  },
  referenceMetadata: metadata,
  rowsScored: comparisons.length,
  rowsSkipped: skipped,
  summary
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(reportDir, 'splits.json'), JSON.stringify({
  schemaVersion: 2,
  generatedAt: report.generatedAt,
  holdoutSeason,
  rows: splits,
  referenceGaps
}, null, 2));
await fs.writeFile(path.join(reportDir, 'status.json'), JSON.stringify({
  code: 'CALIBRATION_READY',
  label: 'CALIBRATION READY',
  integrityVersion: 'v0.4.1',
  generatedAt: report.generatedAt,
  seasons: metadata.seasons || null,
  holdoutSeason,
  rowsScored: comparisons.length,
  comparableRows: summary.overall.comparableN,
  referenceCoverageRate: summary.overall.referenceCoverageRate,
  fullReferenceCoverageRate: summary.overall.fullReferenceCoverageRate,
  referenceGapCount: summary.overall.referenceGapCount,
  genuineZeroOptionCount: summary.overall.genuineZeroOptionCount,
  exactAgreement: summary.overall.exactAgreement,
  decisionSafeRate: summary.overall.decisionSafeRate,
  holdoutExactAgreement: summary.holdout.exactAgreement,
  strongSplitRate: summary.overall.strongSplitRate
}, null, 2));

console.log(`Historical calibration integrity pass complete: ${comparisons.length} states`);
console.log(`Reference-covered primary calls: ${summary.overall.comparableN} (${(100 * summary.overall.referenceCoverageRate).toFixed(1)}%)`);
console.log(`Full 3-option reference coverage: ${(100 * summary.overall.fullReferenceCoverageRate).toFixed(1)}%`);
console.log(`Reference gaps excluded from regret: ${summary.overall.referenceGapCount}`);
console.log(`Genuine numeric-zero reference options retained: ${summary.overall.genuineZeroOptionCount}`);
console.log(`Clean exact agreement: ${(100 * summary.overall.exactAgreement).toFixed(1)}%`);
console.log(`Clean decision-safe rate: ${(100 * summary.overall.decisionSafeRate).toFixed(1)}%`);
console.log(`Holdout ${holdoutSeason} exact agreement: ${(100 * summary.holdout.exactAgreement).toFixed(1)}%`);
console.log(`Clean mean reference regret: ${summary.overall.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Clean strong split rate: ${(100 * summary.overall.strongSplitRate).toFixed(2)}%`);
