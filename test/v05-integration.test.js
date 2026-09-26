import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFourthDown } from '../lib/decision-engine.js';

test('v0.5 can be disabled to reproduce the pre-endgame core on non-terminal states', () => {
  const input = { ydstogo: 2, yardline100: 43, scoreDiff: 0, secondsRemaining: 900, timeouts: 3, opponentTimeouts: 3 };
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  assert.deepEqual(on.options, off.options);
  assert.equal(on.optimal, off.optimal);
  assert.equal(on.diagnostics.endgame.active, false);
});

test('v0.5 activates only in the terminal five-minute window', () => {
  const ev = evaluateFourthDown({ ydstogo: 4, yardline100: 35, scoreDiff: -1, secondsRemaining: 240, timeouts: 2, opponentTimeouts: 2 });
  assert.equal(ev.diagnostics.endgame.active, true);
  assert.equal(ev.modelVersion, 'v0.5-endgame-intelligence');
});

test('down four with seconds left cannot treat a field goal as equivalent to solving the game', () => {
  const input = { ydstogo: 11, yardline100: 21, scoreDiff: -4, secondsRemaining: 43, timeouts: 3, opponentTimeouts: 3 };
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  assert.ok(on.options.FG < off.options.FG);
  assert.ok(on.options.GO > off.options.GO);
  assert.ok(on.diagnostics.endgame.tags.includes('FG_DOES_NOT_TIE_OR_LEAD'));
});

test('trailing one late makes a punt less attractive', () => {
  const input = { ydstogo: 10, yardline100: 70, scoreDiff: -1, secondsRemaining: 40, timeouts: 2, opponentTimeouts: 3 };
  const off = evaluateFourthDown({ ...input, endgameEnabled: false });
  const on = evaluateFourthDown({ ...input, endgameEnabled: true });
  assert.ok(on.options.PUNT < off.options.PUNT);
  assert.ok(on.diagnostics.endgame.tags.includes('TRAILING_PUNT_SCARCITY'));
});
