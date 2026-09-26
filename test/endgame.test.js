import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEndgameIntelligence } from '../lib/endgame.js';

function run(state, options, extra = {}) {
  const yardline100 = state.yardline100 ?? 40;
  const kickDistance = extra.kickDistance ?? (yardline100 + 17);
  return applyEndgameIntelligence({
    ydstogo: 4,
    yardline100,
    scoreDiff: 0,
    secondsRemaining: 600,
    timeouts: 3,
    opponentTimeouts: 3,
    endgameEnabled: true,
    ...state
  }, {
    options,
    fgAvailable: options.FG != null,
    pFg: .8,
    kickDistance,
    ...extra
  });
}

test('v0.5.1 is dormant outside final five minutes', () => {
  const options = { GO: .50, FG: .51, PUNT: .49 };
  const r = run({ secondsRemaining: 301 }, options);
  assert.equal(r.active, false);
  assert.deepEqual(r.options, options);
});

test('terminal trailing state still penalizes a punt', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 40, timeouts: 1 }, { GO: .35, FG: null, PUNT: .36 }, { fgAvailable: false, pFg: null, kickDistance: null });
  assert.equal(r.active, true);
  assert.ok(r.options.PUNT < .36);
  assert.ok(r.shifts.PUNT < 0);
  assert.ok(r.shifts.PUNT > -1.11);
  assert.ok(r.tags.includes('TRAILING_PUNT_SCARCITY'));
});

test('four minutes left no longer gets blanket punt scarcity penalty', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 240, ydstogo: 17, yardline100: 82, timeouts: 3 }, { GO: .19, FG: null, PUNT: .24 }, { fgAvailable: false, pFg: null, kickDistance: null });
  assert.equal(r.shifts.PUNT, 0);
  assert.ok(Math.abs(r.options.PUNT - .24) < 1e-12);
});

test('field goal that still leaves team behind is discounted', () => {
  const r = run({ scoreDiff: -4, secondsRemaining: 43, yardline100: 21 }, { GO: .20, FG: .24, PUNT: .10 }, { fgAvailable: true, pFg: .85, kickDistance: 38 });
  assert.ok(r.options.FG < .24);
  assert.ok(r.options.GO > .20);
  assert.ok(r.tags.includes('FG_DOES_NOT_TIE_OR_LEAD'));
  assert.ok(r.tags.includes('MUST_TD_PATH'));
});

test('reliable terminal field goal that takes lead gets a gated boost', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 30, yardline100: 23 }, { GO: .52, FG: .51, PUNT: .20 }, { fgAvailable: true, pFg: .86, kickDistance: 40 });
  assert.ok(r.options.FG > .51);
  assert.ok(r.tags.includes('FG_TAKES_LEAD'));
});

test('64-yard field goal is not treated as a terminal solution', () => {
  const r = run({ scoreDiff: -1, secondsRemaining: 20, yardline100: 47, ydstogo: 5 }, { GO: .22, FG: .20, PUNT: .17 }, { fgAvailable: true, pFg: .30, kickDistance: 64 });
  assert.equal(r.shifts.FG, 0);
  assert.ok(!r.tags.includes('FG_TAKES_LEAD'));
});

test('long field goal with four minutes left gets no terminal boost', () => {
  const r = run({ scoreDiff: 0, secondsRemaining: 210, yardline100: 44, ydstogo: 2 }, { GO: .45, FG: .44, PUNT: .42 }, { fgAvailable: true, pFg: .39, kickDistance: 61 });
  assert.equal(r.shifts.FG, 0);
  assert.ok(Math.abs(r.options.FG - .44) < 1e-12);
});

test('short-yardage GO is protected against a tying-FG overcorrection', () => {
  const r = run({ scoreDiff: -3, secondsRemaining: 22, yardline100: 3, ydstogo: 1 }, { GO: .54, FG: .47, PUNT: .10 }, { fgAvailable: true, pFg: .99, kickDistance: 20 });
  assert.equal(r.shifts.FG, 0);
  assert.ok(!r.tags.includes('FG_TIES_GAME'));
});

test('tying field goal may receive a small boost on longer fourth down', () => {
  const r = run({ scoreDiff: -3, secondsRemaining: 35, yardline100: 24, ydstogo: 8 }, { GO: .38, FG: .37, PUNT: .10 }, { fgAvailable: true, pFg: .84, kickDistance: 41 });
  assert.ok(r.shifts.FG > 0);
  assert.ok(r.shifts.FG <= .18);
  assert.ok(r.tags.includes('FG_TIES_GAME'));
});

test('genuine zero option remains a probability rather than missing', () => {
  const r = run({ scoreDiff: -4, secondsRemaining: 43, yardline100: 21 }, { GO: .2, FG: 0, PUNT: .1 }, { fgAvailable: true, pFg: .8, kickDistance: 38 });
  assert.notEqual(r.options.FG, null);
  assert.ok(r.options.FG > 0 && r.options.FG < .01);
});
