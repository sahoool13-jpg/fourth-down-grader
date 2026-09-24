import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversionProbability,
  fieldGoalProbability,
  evaluateFourthDown,
  gradeActualDecision,
  evaluateThirdDownPlanning
} from '../lib/decision-engine.js';

test('conversion probability falls as distance rises', () => {
  assert.ok(conversionProbability({ ydstogo: 1 }) > conversionProbability({ ydstogo: 2 }));
  assert.ok(conversionProbability({ ydstogo: 2 }) > conversionProbability({ ydstogo: 5 }));
});

test('field goal probability falls with distance', () => {
  assert.ok(fieldGoalProbability({ kickDistance: 35 }) > fieldGoalProbability({ kickDistance: 50 }));
  assert.ok(fieldGoalProbability({ kickDistance: 50 }) > fieldGoalProbability({ kickDistance: 60 }));
});

test('evaluation returns ranked options, sensitivity and an optimal choice', () => {
  const ev = evaluateFourthDown({ ydstogo: 2, yardline100: 43, scoreDiff: 0, secondsRemaining: 1800, timeouts: 3, opponentTimeouts: 3 });
  assert.ok(['GO', 'PUNT', 'FG'].includes(ev.optimal));
  assert.ok(ev.options[ev.optimal] >= Math.max(...Object.values(ev.options)) - 1e-9);
  assert.ok(ev.sensitivity.robustness >= 0 && ev.sensitivity.robustness <= 1);
  assert.ok(Array.isArray(ev.drivers));
});

test('optimal actual decision gets A+', () => {
  const ev = evaluateFourthDown({ ydstogo: 1, yardline100: 45, scoreDiff: 0, secondsRemaining: 1200 });
  const graded = gradeActualDecision(ev, ev.optimal);
  assert.equal(graded.grade, 'A+');
  assert.equal(graded.wpRegret, 0);
});

test('live baseline anchor is honored', () => {
  const ev = evaluateFourthDown({ ydstogo: 2, yardline100: 50, scoreDiff: -3, secondsRemaining: 800, baselineWp: 0.31 });
  assert.equal(ev.modelStatus, 'live-wp-anchored');
  assert.equal(ev.diagnostics.liveAnchorUsed, true);
  assert.ok(Math.abs(ev.baselineWp - 0.31) < 1e-9);
});

test('late trailing fourth down values possession', () => {
  const ev = evaluateFourthDown({ ydstogo: 5, yardline100: 63, scoreDiff: -7, secondsRemaining: 310, timeouts: 3, opponentTimeouts: 3 });
  assert.equal(ev.optimal, 'GO');
});

test('goal-line short yardage prefers go in neutral state', () => {
  const ev = evaluateFourthDown({ ydstogo: 2, yardline100: 2, scoreDiff: 0, secondsRemaining: 1800, timeouts: 3, opponentTimeouts: 3 });
  assert.equal(ev.optimal, 'GO');
});

test('third-down planner returns a coherent threshold', () => {
  const plan = evaluateThirdDownPlanning({ ydstogo: 7, yardline100: 42, scoreDiff: 0, secondsRemaining: 2100, timeouts: 3, opponentTimeouts: 3 });
  assert.equal(typeof plan.twoDownTerritory, 'boolean');
  if (plan.twoDownTerritory) {
    assert.ok(plan.requiredGain >= 0 && plan.requiredGain < 7);
    assert.ok(plan.remainingDistance > 0);
  }
});
