import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProspectiveEligibleGame,
  stableRecordId,
  buildReferenceMatch,
  referenceRegretPp,
  buildSummary
} from '../scripts/prospective-lib.mjs';

const policy = {
  monitorStartAt: '2026-09-27T09:57:27Z',
  releaseTag: 'v0.5.1',
  minimumSamplesBeforeModelChange: { totalGradable: 500, referenceComparable: 250, endgameReferenceComparable: 75 },
  reviewTriggers: {
    exactAgreementBelow: .72,
    decisionSafeRateBelow: .84,
    meanReferenceRegretPpAbove: .405,
    strongSplitRateAbove: .075,
    singleReferenceRegretPpAtLeast: 8,
    sameDiagnosticTagHarmfulCountAtLeast: 8,
    sameDiagnosticTagCumulativeHarmPpAtLeast: 12,
    v051VsLegacyNetReferenceRegretSavedPpBelow: 0,
    v051VsLegacyMinimumFlipsForNetTrigger: 20
  }
};

test('prospective boundary excludes games already underway before release', () => {
  assert.equal(isProspectiveEligibleGame({ date: '2026-09-27T09:57:26Z' }), false);
  assert.equal(isProspectiveEligibleGame({ date: '2026-09-27T09:57:27Z' }), true);
  assert.equal(isProspectiveEligibleGame({ date: '2026-09-27T17:00:00Z' }), true);
});

test('stable record ids are deterministic', () => {
  const row = { eventId:'401', id:'123', quarter:4, clock:'1:20' };
  assert.equal(stableRecordId(row), '401:123');
  assert.equal(stableRecordId(row), stableRecordId({ ...row }));
});

test('null reference actions are unavailable rather than fake zero WP', () => {
  const ref = buildReferenceMatch({ optimal:'GO', go_wp:.61, fg_wp:null, punt_wp:.55 }, 'PLAY_ID');
  assert.equal(ref.options.FG, null);
  assert.equal(referenceRegretPp(ref, 'FG'), null);
  assert.ok(referenceRegretPp(ref, 'PUNT') > 0);
});

test('summary stays locked before preregistered minimum sample', () => {
  const rec = {
    id:'g:p', capturedAt:'2026-09-27T18:00:00Z',
    game:{eventId:'g',name:'A @ B',kickoff:'2026-09-27T17:00:00Z'},
    offense:{abbreviation:'A'}, defense:{abbreviation:'B'},
    state:{quarter:1,clock:'10:00',ydstogo:2,yardline100:45,scoreDiff:0},
    decision:{actual:'PUNT'},
    model:{v051:{optimal:'GO',wpRegretPp:1.2,endgameActive:false,endgameTags:[]},legacy:{optimal:'PUNT'}},
    outcome:{text:'punt'},
    referencePipeline:{code:'DATA_UNAVAILABLE'},
    reference:null
  };
  const s = buildSummary([rec], policy, { lastMaterialUpdateAt:'x' });
  assert.equal(s.modelHealth.state, 'LOCKED_SAMPLE');
  assert.equal(s.sample.gradable, 1);
  assert.equal(s.teams[0].totalModelWpaBurnPp, 1.2);
});

test('single catastrophic matched reference miss triggers review even before maturity', () => {
  const rec = {
    id:'g:p', capturedAt:'2026-09-27T18:00:00Z',
    game:{eventId:'g',name:'A @ B',kickoff:'2026-09-27T17:00:00Z'},
    offense:{abbreviation:'A'}, defense:{abbreviation:'B'},
    state:{quarter:4,clock:'0:30',ydstogo:4,yardline100:30,scoreDiff:-1},
    decision:{actual:'GO'},
    model:{v051:{optimal:'GO',wpRegretPp:0,endgameActive:true,endgameTags:['X'],certainty:'CLEAR'},legacy:{optimal:'FG'}},
    outcome:{text:'play'},
    referencePipeline:{code:'READY'},
    reference:{status:'MATCHED',optimal:'FG',certainty:'CLEAR',edgePp:3,options:{GO:.40,FG:.50,PUNT:.20}}
  };
  const s = buildSummary([rec], policy, { lastMaterialUpdateAt:'x' });
  assert.equal(s.modelHealth.state, 'REVIEW');
  assert.equal(s.modelHealth.triggers[0].code, 'CATASTROPHIC_REFERENCE_MISS');
});
