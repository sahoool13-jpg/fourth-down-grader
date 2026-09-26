import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEndgameIntelligence } from '../lib/endgame.js';

function run(state, options, extra = {}) {
  return applyEndgameIntelligence({
    ydstogo: 4,
    yardline100: 40,
    scoreDiff: 0,
    secondsRemaining: 600,
    timeouts: 3,
    opponentTimeouts: 3,
    endgameEnabled: true,
    ...state
  }, { options, fgAvailable: options.FG != null, pFg: .8, ...extra });
}

test('endgame layer is dormant outside final five minutes', () => {
  const options = { GO: .50, FG: .51, PUNT: .49 };
  const r = run({ secondsRemaining: 301 }, options);
  assert.equal(r.active, false);
  assert.deepEqual(r.options, options);
});

test('trailing late penalizes a punt because possession is scarce', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 40, timeouts: 1 }, { GO: .35, FG: null, PUNT: .36 }, { fgAvailable: false, pFg: null });
  assert.equal(r.active, true);
  assert.ok(r.options.PUNT < .36);
  assert.ok(r.shifts.PUNT < -1);
  assert.ok(r.tags.includes('TRAILING_PUNT_SCARCITY'));
});

test('field goal that still leaves team behind is discounted', () => {
  const r = run({ scoreDiff: -4, secondsRemaining: 43 }, { GO: .20, FG: .24, PUNT: .10 }, { fgAvailable: true, pFg: .85 });
  assert.ok(r.options.FG < .24);
  assert.ok(r.options.GO > .20);
  assert.ok(r.tags.includes('FG_DOES_NOT_TIE_OR_LEAD'));
  assert.ok(r.tags.includes('MUST_TD_PATH'));
});

test('late field goal that takes the lead is boosted', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 30 }, { GO: .48, FG: .49, PUNT: .20 }, { fgAvailable: true, pFg: .86 });
  assert.ok(r.options.FG > .49);
  assert.ok(r.options.GO < .48);
  assert.ok(r.tags.includes('FG_TAKES_LEAD'));
});

test('tied late in reliable range creates field-goal terminal value', () => {
  const r = run({ scoreDiff: 0, secondsRemaining: 17 }, { GO: .52, FG: .50, PUNT: .20 }, { fgAvailable: true, pFg: .98 });
  assert.ok(r.options.FG > .50);
  assert.ok(r.tags.includes('TIED_FG_WINDOW'));
});

test('genuine zero option stays a genuine probability, not missing', () => {
  const r = run({ scoreDiff: -4, secondsRemaining: 43 }, { GO: .2, FG: 0, PUNT: .1 }, { fgAvailable: true, pFg: .8 });
  assert.notEqual(r.options.FG, null);
  assert.ok(r.options.FG > 0 && r.options.FG < .01);
});
