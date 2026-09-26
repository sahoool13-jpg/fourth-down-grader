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


test('completed fourth down carries displayable situation metadata', () => {
  const x = structuredClone(fixture);
  x.plays[0].start.possessionText = 'MIA 45';
  x.plays[0].start.downDistanceText = '4th & 4 at MIA 45';
  x.plays[0].start.shortDownDistanceText = '4th & 4';
  x.plays[0].start.yardsToEndzone = 55;
  const g = parseGameSummary(x);
  const d = g.completedFourthDowns[0];
  assert.equal(d.quarter, 2);
  assert.equal(d.clock, '8:22');
  assert.equal(d.ydstogo, 4);
  assert.equal(d.yardline100, 55);
  assert.equal(d.fieldPositionText, 'MIA 45');
  assert.equal(d.verifiedState, true);
});

test('explicit field-side text beats ambiguous numeric yard fields', () => {
  const x = structuredClone(fixture);
  x.plays = [{
    id: 'mia-own-12',
    sequenceNumber: '200',
    type: { text: 'Punt' },
    text: 'D.Punter punts 52 yards to BUF 36, fair catch.',
    // Deliberately conflicting attribution fallback: start.team must win.
    team: { id: '2' },
    period: { number: 2 },
    clock: { displayValue: '9:42' },
    homeScore: 7,
    awayScore: 7,
    start: {
      down: 4,
      distance: 9,
      // Simulate the bad ESPN ambiguity seen in the real game: numeric says 12,
      // while the explicit text identifies the ball as MIA 12.
      yardLine: 12,
      yardsToEndzone: 12,
      downDistanceText: '4th & 9 at MIA 12',
      possessionText: 'MIA 12',
      team: { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/15' }
    }
  }];
  const g = parseGameSummary(x);
  const d = g.completedFourthDowns[0];
  assert.equal(d.offense.abbreviation, 'MIA');
  assert.equal(d.defense.abbreviation, 'BUF');
  assert.equal(d.yardline100, 88);
  assert.equal(d.fieldPositionText, 'MIA 12');
  assert.equal(d.fieldPositionSource, 'start.downDistanceText');
  assert.match(d.numericFieldConflict, /start\.yardsToEndzone=12/);
  assert.equal(d.possessionVerified, true);
  assert.equal(d.verifiedState, true);
});


test('punt geometry corrects ESPN-style flipped team abbreviation on the fourth-down spot', () => {
  const x = structuredClone(fixture);
  x.plays = [{
    id: 'flip-side', sequenceNumber: '250', type: { text: 'Punt' },
    text: 'D.Punter punts 52 yards to BUF 36, fair catch.',
    period: { number: 2 }, clock: { displayValue: '9:42' }, homeScore: 7, awayScore: 7,
    start: {
      down: 4, distance: 9,
      // Upstream display bug: yard number is right but team side is flipped.
      downDistanceText: '4th & 9 at BUF 12',
      possessionText: 'BUF 12',
      yardsToEndzone: 12,
      team: { id: '15' }
    }
  }];
  const d = parseGameSummary(x).completedFourthDowns[0];
  assert.equal(d.offense.abbreviation, 'MIA');
  assert.equal(d.yardline100, 88);
  assert.equal(d.fieldPositionText, 'MIA 12');
  assert.equal(d.fieldPositionSource, 'punt-geometry-override');
  assert.match(d.fieldPositionSourceConflict, /contradicted/);
  assert.equal(d.verifiedState, true);
});


test('punt geometry independently verifies own-territory field side', () => {
  const x = structuredClone(fixture);
  x.plays = [{
    id: 'mia-own-37', sequenceNumber: '300', type: { text: 'Punt' },
    text: 'D.Punter punts 64 yards to BUF -1, touchback.',
    period: { number: 2 }, clock: { displayValue: '15:00' }, homeScore: 7, awayScore: 7,
    start: {
      down: 4, distance: 4,
      downDistanceText: '4th & 4 at MIA 37',
      possessionText: 'MIA 37',
      // Deliberately misleading numeric field.
      yardsToEndzone: 37,
      team: { id: '15' }
    }
  }];
  const d = parseGameSummary(x).completedFourthDowns[0];
  assert.equal(d.yardline100, 63);
  assert.equal(d.fieldPositionText, 'MIA 37');
  assert.equal(d.verifiedState, true);
});


test('opponent-territory punt remains opponent territory when text and geometry agree', () => {
  const x = structuredClone(fixture);
  x.plays = [{
    id: 'mia-buf-41', sequenceNumber: '400', type: { text: 'Punt' },
    text: 'D.Punter punts 30 yards to BUF 11, fair catch.',
    period: { number: 2 }, clock: { displayValue: '10:41' }, homeScore: 7, awayScore: 7,
    start: {
      down: 4, distance: 6,
      downDistanceText: '4th & 6 at BUF 41',
      possessionText: 'BUF 41',
      yardsToEndzone: 41,
      team: { id: '15' }
    }
  }];
  const d = parseGameSummary(x).completedFourthDowns[0];
  assert.equal(d.yardline100, 41);
  assert.equal(d.fieldPositionText, 'BUF 41');
  assert.equal(d.verifiedState, true);
});


test('contradictory pre-snap text fields force REVIEW instead of a fabricated state', () => {
  const x = structuredClone(fixture);
  x.plays = [{
    id: 'conflict', sequenceNumber: '500', type: { text: 'Pass Incompletion' },
    text: 'Pass incomplete on fourth down.',
    period: { number: 2 }, clock: { displayValue: '9:42' }, homeScore: 7, awayScore: 7,
    start: {
      down: 4, distance: 9,
      downDistanceText: '4th & 9 at MIA 12',
      possessionText: 'BUF 12',
      team: { id: '15' }
    }
  }];
  const d = parseGameSummary(x).completedFourthDowns[0];
  assert.equal(d.yardline100, null);
  assert.equal(d.verifiedState, false);
  assert.match(d.fieldPositionConflict, /pre-snap text disagrees/);
});

test('completed scoring play uses pre-play score rather than leaking the made kick into state', () => {
  const x = structuredClone(fixture);
  x.plays = [
    {
      id: 'prior', sequenceNumber: '100', type: { text: 'Pass Incompletion' }, text: 'Incomplete.',
      period: { number: 2 }, clock: { displayValue: '4:55' }, homeScore: 7, awayScore: 7,
      start: { down: 3, distance: 2, yardLine: 26, team: { id: '15' } }
    },
    {
      id: 'fg', sequenceNumber: '200', type: { text: 'Field Goal Good' }, text: 'Kicker 44 yard field goal is GOOD.',
      period: { number: 2 }, clock: { displayValue: '4:48' }, homeScore: 7, awayScore: 10,
      scoringPlay: true, scoreValue: 3,
      start: { down: 4, distance: 2, yardLine: 26, yardsToEndzone: 26, possessionText: 'BUF 26', team: { id: '15' } }
    }
  ];
  const g = parseGameSummary(x);
  const d = g.completedFourthDowns[0];
  assert.equal(d.offense.abbreviation, 'MIA');
  assert.equal(d.offenseScore, 7);
  assert.equal(d.defenseScore, 7);
  assert.equal(d.scoreDiff, 0);
  assert.equal(d.scoreText, 'MIA 7–7 BUF');
});
