import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareCalibrationRow,
  buildCalibrationSummary,
  certaintyFromEdgePp,
  optionsFromReference,
  referenceOptionIntegrity,
  selectWorstSplits,
  selectReferenceGaps
} from '../lib/calibration.js';

const ref = {
  season: 2025, week: 1, game_id: '2025_01_A_B', play_id: '1',
  posteam: 'A', defteam: 'B', qtr: 4, quarter_seconds_remaining: 120,
  game_seconds_remaining: 120, ydstogo: 2, yardline_100: 45,
  score_differential: -3, actual_decision: 'PUNT',
  go_wp: .45, fg_wp: .43, punt_wp: .40, desc: 'test'
};

const evGo = { optimal: 'GO', certainty: 'CLEAR', options: { GO: .50, FG: .45, PUNT: .40 } };

test('certainty thresholds match benchmark policy', () => {
  assert.equal(certaintyFromEdgePp(2.0), 'CLEAR');
  assert.equal(certaintyFromEdgePp(.75), 'LEAN');
  assert.equal(certaintyFromEdgePp(.2), 'TOSS-UP');
});

test('null reference probability remains unavailable instead of becoming fake zero', () => {
  const opts = optionsFromReference({ go_wp: .8, fg_wp: .7, punt_wp: null });
  assert.equal(opts.PUNT, null);
  const integrity = referenceOptionIntegrity({ go_wp: .8, fg_wp: .7, punt_wp: null });
  assert.deepEqual(integrity.unavailableActions, ['PUNT']);
  assert.equal(integrity.partial, true);
});

test('genuine numeric zero remains a real priced option', () => {
  const opts = optionsFromReference({ go_wp: .8, fg_wp: .7, punt_wp: 0 });
  assert.equal(opts.PUNT, 0);
  const integrity = referenceOptionIntegrity({ go_wp: .8, fg_wp: .7, punt_wp: 0 });
  assert.deepEqual(integrity.genuineZeroActions, ['PUNT']);
  assert.equal(integrity.complete, true);
});

test('missing punt inside opponent 30 is tagged as an nfl4th support-range gap', () => {
  const integrity = referenceOptionIntegrity({ yardline_100: 24, go_wp: .99, fg_wp: .99, punt_wp: null });
  assert.equal(integrity.unavailableReasons.PUNT, 'NFL4TH_PUNT_REFERENCE_OUTSIDE_SUPPORT_RANGE');
});

test('reference regret prices the primary choice using reference WPs', () => {
  const ev = { optimal: 'FG', certainty: 'LEAN', options: { GO: .48, FG: .49, PUNT: .42 } };
  const c = compareCalibrationRow(ref, ev);
  assert.equal(c.referenceOptimal, 'GO');
  assert.equal(c.primaryOptimal, 'FG');
  assert.ok(Math.abs(c.referenceRegretPp - 2.0) < 1e-9);
  assert.equal(c.strongSplit, true);
  assert.equal(c.comparable, true);
});

test('unsupported primary action is a reference gap, not a 100 point model error', () => {
  const partial = { ...ref, go_wp: .999, fg_wp: .998, punt_wp: null };
  const ev = { optimal: 'PUNT', certainty: 'TOSS-UP', options: { GO: .997, FG: .998, PUNT: .999 } };
  const c = compareCalibrationRow(partial, ev);
  assert.equal(c.comparable, false);
  assert.equal(c.unsupportedPrimary, true);
  assert.equal(c.referenceRegretPp, null);
  assert.equal(c.strongSplit, null);
  assert.deepEqual(c.referenceUnavailableActions, ['PUNT']);
});

test('decision-safe disagreement allows tiny reference regret', () => {
  const tiny = { ...ref, go_wp: .450, fg_wp: .446, punt_wp: .41 };
  const ev = { optimal: 'FG', certainty: 'TOSS-UP', options: { GO: .50, FG: .501, PUNT: .44 } };
  const c = compareCalibrationRow(tiny, ev);
  assert.equal(c.exact, false);
  assert.equal(c.decisionSafe, true);
  assert.equal(c.materialSplit, false);
});

test('summary uses clean comparable denominator and exposes reference coverage', () => {
  const full = compareCalibrationRow({ ...ref, season: 2024, play_id: 'a' }, evGo);
  const gap = compareCalibrationRow(
    { ...ref, season: 2024, play_id: 'b', go_wp: .55, fg_wp: .54, punt_wp: null },
    { optimal: 'PUNT', certainty: 'TOSS-UP', options: { GO:.53, FG:.52, PUNT:.56 } }
  );
  const s = buildCalibrationSummary([full, gap], 2025);
  assert.equal(s.overall.n, 2);
  assert.equal(s.overall.comparableN, 1);
  assert.equal(s.overall.referenceGapCount, 1);
  assert.equal(s.overall.referenceCoverageRate, .5);
  assert.equal(s.overall.exactAgreement, 1);
});

test('summary preserves a separate holdout season', () => {
  const a = compareCalibrationRow({ ...ref, season: 2024, play_id: 'a' }, evGo);
  const b = compareCalibrationRow({ ...ref, season: 2025, play_id: 'b' }, evGo);
  const s = buildCalibrationSummary([a,b], 2025);
  assert.equal(s.development.n, 1);
  assert.equal(s.holdout.n, 1);
});

test('worst split list excludes reference gaps and is ordered by clean regret', () => {
  const e1 = { optimal: 'FG', certainty: 'CLEAR', options: { GO:.3, FG:.4, PUNT:.2 } };
  const e2 = { optimal: 'PUNT', certainty: 'CLEAR', options: { GO:.3, FG:.2, PUNT:.4 } };
  const a = compareCalibrationRow({ ...ref, play_id:'a', go_wp:.50, fg_wp:.49, punt_wp:.48 }, e1);
  const b = compareCalibrationRow({ ...ref, play_id:'b', go_wp:.60, fg_wp:.20, punt_wp:.10 }, e2);
  const gap = compareCalibrationRow(
    { ...ref, play_id:'gap', go_wp:.99, fg_wp:.98, punt_wp:null },
    { optimal:'PUNT', certainty:'CLEAR', options:{ GO:.7, FG:.6, PUNT:.8 } }
  );
  const rows = selectWorstSplits([a,b,gap], 3);
  assert.equal(rows[0].playId, 'b');
  assert.equal(rows.some(r => r.playId === 'gap'), false);
  assert.equal(selectReferenceGaps([a,b,gap], 3)[0].playId, 'gap');
});
