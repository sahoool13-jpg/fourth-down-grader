import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBenchmarkAgreement } from '../lib/benchmark.js';
import { evaluateFourthDown } from '../lib/decision-engine.js';

test('benchmark agreement summary identifies exact agreement and strong splits', () => {
  const rows = [
    { id: '1', optimal: 'GO', certainty: 'CLEAR' },
    { id: '2', optimal: 'PUNT', certainty: 'CLEAR' },
    { id: '3', optimal: 'FG', certainty: 'TOSS-UP' }
  ];
  const benchmark = { rows: [
    { play_id: '1', optimal: 'GO', certainty: 'CLEAR' },
    { play_id: '2', optimal: 'GO', certainty: 'CLEAR' },
    { play_id: '3', optimal: 'GO', certainty: 'TOSS-UP' }
  ]};
  const s = summarizeBenchmarkAgreement(rows, benchmark);
  assert.equal(s.matched, 3);
  assert.equal(s.eligible, 3);
  assert.equal(s.strongSplits, 1);
  assert.equal(Math.round(s.exactAgreement * 100), 33);
});

test('published nfl4th Packers-Bucs example is directionally matched by primary model', () => {
  // nfl4th docs: GB down 8, 2:09 left, 4th & 8 at TB 8. nfl4th prefers GO
  // (13.68% go WP vs 10.02% FG WP). We require the same strategic direction.
  const ev = evaluateFourthDown({
    ydstogo: 8,
    yardline100: 8,
    scoreDiff: -8,
    secondsRemaining: 129,
    timeouts: 3,
    opponentTimeouts: 3,
    indoor: false
  });
  assert.equal(ev.optimal, 'GO');
  assert.ok(ev.options.GO > ev.options.FG);
});
