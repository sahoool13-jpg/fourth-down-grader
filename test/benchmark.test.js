import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBenchmarkStatus, summarizeBenchmarkAgreement } from '../lib/benchmark.js';
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

test('benchmark status keeps current-game data-unavailable state explicit', () => {
  const status = normalizeBenchmarkStatus({
    code: 'DATA_NOT_YET_AVAILABLE',
    label: '2026 DATA NOT YET AVAILABLE',
    game_id: '2026_03_ATL_GB',
    season: 2026,
    message: 'season feed not published yet'
  }, { eventId: '123', expectedGameId: '2026_03_ATL_GB' });
  assert.equal(status.code, 'DATA_NOT_YET_AVAILABLE');
  assert.equal(status.label, '2026 DATA NOT YET AVAILABLE');
});

test('benchmark status does not leak a different game pipeline result into the selected game', () => {
  const status = normalizeBenchmarkStatus({
    code: 'BENCHMARK_READY',
    game_id: '2026_03_ATL_GB'
  }, { eventId: '999', expectedGameId: '2026_03_BUF_MIA' });
  assert.equal(status.code, 'GAME_NOT_FOUND');
  assert.match(status.message, /not 2026_03_BUF_MIA/);
});

test('published nfl4th Packers-Bucs example is directionally matched by primary model', () => {
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
