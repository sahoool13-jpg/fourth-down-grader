import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareCalibrationRow,
  buildCalibrationSummary,
  certaintyFromEdgePp,
  selectWorstSplits
} from '../lib/calibration.js';

const ref = {
  season: 2025, week: 1, game_id: '2025_01_A_B', play_id: '1',
  posteam: 'A', defteam: 'B', qtr: 4, quarter_seconds_remaining: 120,
  game_seconds_remaining: 120, ydstogo: 2, yardline_100: 45,
  score_differential: -3, actual_decision: 'PUNT',
  go_wp: .45, fg_wp: .43, punt_wp: .40, desc: 'test'
};

test('certainty thresholds match benchmark policy', () => {
  assert.equal(certaintyFromEdgePp(2.0), 'CLEAR');
  assert.equal(certaintyFromEdgePp(.75), 'LEAN');
  assert.equal(certaintyFromEdgePp(.2), 'TOSS-UP');
});

test('reference regret prices the primary choice using reference WPs', () => {
  const ev = { optimal: 'FG', certainty: 'LEAN', options: { GO: .48, FG: .49, PUNT: .42 } };
  const c = compareCalibrationRow(ref, ev);
  assert.equal(c.referenceOptimal, 'GO');
  assert.equal(c.primaryOptimal, 'FG');
  assert.ok(Math.abs(c.referenceRegretPp - 2.0) < 1e-9);
  assert.equal(c.strongSplit, true);
});

test('decision-safe disagreement allows tiny reference regret', () => {
  const tiny = { ...ref, go_wp: .450, fg_wp: .446, punt_wp: .41 };
  const ev = { optimal: 'FG', certainty: 'TOSS-UP', options: { GO: .50, FG: .501, PUNT: .44 } };
  const c = compareCalibrationRow(tiny, ev);
  assert.equal(c.exact, false);
  assert.equal(c.decisionSafe, true);
  assert.equal(c.materialSplit, false);
});

test('summary preserves a separate holdout season', () => {
  const evGo = { optimal: 'GO', certainty: 'CLEAR', options: { GO: .50, FG: .45, PUNT: .40 } };
  const a = compareCalibrationRow({ ...ref, season: 2024, play_id: 'a' }, evGo);
  const b = compareCalibrationRow({ ...ref, season: 2025, play_id: 'b' }, evGo);
  const s = buildCalibrationSummary([a,b], 2025);
  assert.equal(s.development.n, 1);
  assert.equal(s.holdout.n, 1);
});

test('worst split list is ordered by reference regret', () => {
  const e1 = { optimal: 'FG', certainty: 'CLEAR', options: { GO:.3, FG:.4, PUNT:.2 } };
  const e2 = { optimal: 'PUNT', certainty: 'CLEAR', options: { GO:.3, FG:.2, PUNT:.4 } };
  const a = compareCalibrationRow({ ...ref, play_id:'a', go_wp:.50, fg_wp:.49, punt_wp:.48 }, e1);
  const b = compareCalibrationRow({ ...ref, play_id:'b', go_wp:.60, fg_wp:.20, punt_wp:.10 }, e2);
  const rows = selectWorstSplits([a,b], 2);
  assert.equal(rows[0].playId, 'b');
});
