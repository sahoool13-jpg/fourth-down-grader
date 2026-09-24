import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGameSummary, normalizeDecisionFromPlay } from '../lib/espn.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/espn-summary-sample.json', import.meta.url), 'utf8'));

test('ESPN parser detects pending fourth down', () => {
  const g = parseGameSummary(fixture);
  assert.equal(g.pendingFourthDown.offense.abbreviation, 'MIA');
  assert.equal(g.pendingFourthDown.ydstogo, 5);
  assert.equal(g.pendingFourthDown.scoreDiff, -7);
  assert.equal(g.pendingFourthDown.secondsRemaining, 310);
});

test('ESPN parser identifies completed punt decision', () => {
  const g = parseGameSummary(fixture);
  assert.equal(g.completedFourthDowns.length, 1);
  assert.equal(g.completedFourthDowns[0].actualDecision, 'PUNT');
  assert.equal(g.completedFourthDowns[0].ydstogo, 4);
});

test('ESPN parser uses win probability timeline as pre-play/live anchor', () => {
  const x = structuredClone(fixture);
  x.winprobability = [
    { playId: 'prior', homeWinPercentage: 0.50 },
    { playId: 'p1', homeWinPercentage: 0.54 }
  ];
  const g = parseGameSummary(x);
  // MIA is away, so the last home WP 54% means MIA live WP 46%.
  assert.ok(Math.abs(g.pendingFourthDown.baselineWp - 0.46) < 1e-9);
  // The p1 pre-play anchor is the preceding 50/50 state.
  assert.ok(Math.abs(g.completedFourthDowns[0].baselineWp - 0.50) < 1e-9);
});

test('fake punt is graded as GO and no-play penalty is ignored', () => {
  assert.equal(normalizeDecisionFromPlay({ type: { text: 'Fake Punt' }, text: 'Fake punt pass complete' }), 'GO');
  assert.equal(normalizeDecisionFromPlay({ type: { text: 'Penalty' }, text: 'False Start. No Play.' }), null);
});
