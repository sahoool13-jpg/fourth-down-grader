import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateFourthDown } from '../lib/decision-engine.js';
import {
  compareCalibrationRow,
  buildCalibrationSummary,
  selectWorstSplits
} from '../lib/calibration.js';

const referencePath = process.env.CALIBRATION_REFERENCE || '.calibration/reference.json';
const reportDir = 'public/calibration';
const holdoutEnv = Number(process.env.HOLDOUT_SEASON || NaN);

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

  // "liveLike" mirrors production behavior by anchoring our structural deltas to a
  // pre-play state WP. It does not change the action ordering, but it is the fairest
  // historical analogue for absolute WP comparisons.
  const liveLike = evaluateFourthDown({
    ...input,
    baselineWp: Number.isFinite(Number(row.wp)) ? Number(row.wp) : null
  });

  // Two diagnostics reveal how much of absolute WP error comes from the baseline
  // rather than the fourth-down counterfactual deltas.
  const structural = evaluateFourthDown({ ...input, baselineWp: null });
  const vegasAnchor = evaluateFourthDown({
    ...input,
    baselineWp: Number.isFinite(Number(row.vegas_wp)) ? Number(row.vegas_wp) : null
  });

  const comparison = compareCalibrationRow(row, liveLike, { structural, vegasAnchor });
  if (!comparison) {
    skipped++;
    continue;
  }
  comparisons.push(comparison);
}

if (comparisons.length < 1000) {
  throw new Error(`Only ${comparisons.length} comparable fourth-down decisions`);
}

const summary = buildCalibrationSummary(comparisons, holdoutSeason);
const splits = selectWorstSplits(comparisons, 120);

const report = {
  schemaVersion: 1,
  productVersion: 'v0.4',
  modelCore: 'v0.3.2 anchored-counterfactual',
  generatedAt: new Date().toISOString(),
  methodology: {
    reference: 'nfl4th',
    referenceFunction: 'nfl4th::load_4th_pbp(fast = FALSE)',
    primary: '4TH DOWN anchored-counterfactual model',
    headlineMetric: 'Reference regret: nfl4th optimal WP minus nfl4th WP of the primary model choice.',
    decisionSafeThresholdPp: 0.75,
    strongSplitThresholdPp: 2.0,
    holdoutSeason,
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
  schemaVersion: 1,
  generatedAt: report.generatedAt,
  holdoutSeason,
  rows: splits
}, null, 2));
await fs.writeFile(path.join(reportDir, 'status.json'), JSON.stringify({
  code: 'CALIBRATION_READY',
  label: 'CALIBRATION READY',
  generatedAt: report.generatedAt,
  seasons: metadata.seasons || null,
  holdoutSeason,
  rowsScored: comparisons.length,
  exactAgreement: summary.overall.exactAgreement,
  decisionSafeRate: summary.overall.decisionSafeRate,
  holdoutExactAgreement: summary.holdout.exactAgreement,
  strongSplitRate: summary.overall.strongSplitRate
}, null, 2));

console.log(`Historical calibration complete: ${comparisons.length} decisions`);
console.log(`Exact agreement: ${(100 * summary.overall.exactAgreement).toFixed(1)}%`);
console.log(`Within 0.75 pp reference regret: ${(100 * summary.overall.decisionSafeRate).toFixed(1)}%`);
console.log(`Holdout ${holdoutSeason} exact agreement: ${(100 * summary.holdout.exactAgreement).toFixed(1)}%`);
console.log(`Mean reference regret: ${summary.overall.meanReferenceRegretPp.toFixed(3)} pp`);
console.log(`Strong split rate: ${(100 * summary.overall.strongSplitRate).toFixed(2)}%`);
