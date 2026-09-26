import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFourthDown } from '../lib/decision-engine.js';

test('v0.5.1 preserves legacy output outside endgame window', () => {
  const input = { ydstogo: 2, yardline100: 43, scoreDiff: 0, secondsRemaining: 900, timeouts: 3, opponentTimeouts: 3 };
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  assert.deepEqual(on.options, off.options);
  assert.equal(on.optimal, off.optimal);
  assert.equal(on.diagnostics.endgame.active, false);
});

test('v0.5.1 still activates inside final five minutes', () => {
  const ev = evaluateFourthDown({ ydstogo: 4, yardline100: 35, scoreDiff: -1, secondsRemaining: 240, timeouts: 2, opponentTimeouts: 2 });
  assert.equal(ev.diagnostics.endgame.active, true);
});

test('terminal must-TD state suppresses field goal', () => {
  const input = { ydstogo: 11, yardline100: 21, scoreDiff: -4, secondsRemaining: 43, timeouts: 3, opponentTimeouts: 3 };
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  assert.ok(on.options.FG < off.options.FG);
  assert.ok(on.options.GO > off.options.GO);
  assert.ok(on.diagnostics.endgame.tags.includes('FG_DOES_NOT_TIE_OR_LEAD'));
});

test('terminal trailing state makes punt less attractive', () => {
  const input = { ydstogo: 10, yardline100: 70, scoreDiff: -1, secondsRemaining: 40, timeouts: 2, opponentTimeouts: 3 };
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  assert.ok(on.options.PUNT < off.options.PUNT);
});

test('four-minute trailing long-yardage state is no longer force-flipped by punt penalty', () => {
  const input = { ydstogo: 17, yardline100: 82, scoreDiff: -1, secondsRemaining: 240, timeouts: 3, opponentTimeouts: 3 };
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  assert.equal(on.diagnostics.endgame.logitShifts.PUNT, 0);
  assert.ok(Math.abs(on.options.PUNT - off.options.PUNT) < 1e-12);
});

test('long terminal field goal does not receive score-value boost', () => {
  const input = { ydstogo: 5, yardline100: 47, scoreDiff: -1, secondsRemaining: 20, timeouts: 1, opponentTimeouts: 2 };
  const ev = evaluateFourthDown(input);
  assert.ok(!ev.diagnostics.endgame.tags.includes('FG_TAKES_LEAD'));
  assert.equal(ev.diagnostics.endgame.logitShifts.FG, 0);
});
