import crypto from 'node:crypto';

export const RELEASE_START_AT = '2026-09-27T09:57:27Z';
export const RELEASE_TAG = 'v0.5.1';
export const EVALUATED_CANDIDATE_COMMIT = '8daaa8f75787e4f28d25af6462142518f4594e9a';

export const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function isProspectiveEligibleGame(game, startAt = RELEASE_START_AT) {
  const kickoff = new Date(game?.date || game?.kickoff || 0).getTime();
  const start = new Date(startAt).getTime();
  return Number.isFinite(kickoff) && Number.isFinite(start) && kickoff >= start;
}

export function stableRecordId(row) {
  const eventId = String(row?.eventId || row?.gameId || '').trim();
  const playId = String(row?.id || row?.playId || '').trim();
  if (eventId && playId) return `${eventId}:${playId}`;

  const fallback = JSON.stringify({
    eventId,
    q: row?.quarter,
    clock: row?.clock,
    offense: row?.offense?.abbreviation,
    ydstogo: row?.ydstogo,
    yardline100: row?.yardline100,
    description: row?.description
  });
  return `${eventId || 'unknown'}:sha256:${crypto.createHash('sha256').update(fallback).digest('hex').slice(0, 20)}`;
}

export function inputFromLedger(row, endgameEnabled = true) {
  const payload = {
    ydstogo: finite(row?.ydstogo),
    yardline100: finite(row?.yardline100),
    scoreDiff: finite(row?.scoreDiff),
    secondsRemaining: finite(row?.secondsRemaining),
    timeouts: finite(row?.timeouts),
    opponentTimeouts: finite(row?.opponentTimeouts),
    indoor: Boolean(row?.indoor),
    baselineWp: finite(row?.baselineWp),
    endgameEnabled
  };
  if (row?.actualDecision) payload.actualDecision = String(row.actualDecision).toUpperCase();
  return payload;
}

function cleanOptionObject(options = {}) {
  const out = {};
  for (const key of ['GO', 'FG', 'PUNT']) {
    const n = finite(options?.[key]);
    out[key] = n;
  }
  return out;
}

export function snapshotEvaluation(ev = {}) {
  return {
    optimal: ev?.optimal || null,
    certainty: ev?.certainty || null,
    edge: finite(ev?.edge),
    baselineWp: finite(ev?.baselineWp),
    options: cleanOptionObject(ev?.options),
    grade: ev?.grade || null,
    wpRegret: finite(ev?.wpRegret),
    wpRegretPp: finite(ev?.wpRegret) == null ? null : 100 * Number(ev.wpRegret),
    robustness: finite(ev?.sensitivity?.robustness),
    endgameActive: Boolean(ev?.diagnostics?.endgame?.active),
    endgameTags: Array.isArray(ev?.diagnostics?.endgame?.tags) ? [...ev.diagnostics.endgame.tags] : [],
    liveAnchorUsed: Boolean(ev?.diagnostics?.liveAnchorUsed)
  };
}

export function makeSnapshotHash(record) {
  const sealed = {
    id: record.id,
    state: record.state,
    actualDecision: record.decision?.actual,
    v051: record.model?.v051,
    legacy: record.model?.legacy,
    release: record.release
  };
  return crypto.createHash('sha256').update(JSON.stringify(sealed)).digest('hex');
}

export function quarterClockSeconds(clock) {
  const m = String(clock || '').match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function benchmarkStateScore(record, b) {
  const offense = String(record?.offense?.abbreviation || '').toUpperCase();
  const posteam = String(b?.posteam || '').toUpperCase();
  if (!offense || !posteam || offense !== posteam) return -Infinity;

  const q = Number(record?.state?.quarter);
  const bq = Number(b?.qtr);
  if (!Number.isFinite(q) || !Number.isFinite(bq) || q !== bq) return -Infinity;

  let score = 8;
  const rowClock = quarterClockSeconds(record?.state?.clock);
  const benchClock = finite(b?.quarter_seconds_remaining);
  if (rowClock != null && benchClock != null) {
    const dt = Math.abs(rowClock - benchClock);
    if (dt <= 1) score += 6;
    else if (dt <= 5) score += 4;
    else if (dt <= 15) score += 1;
    else return -Infinity;
  }

  const rowToGo = finite(record?.state?.ydstogo);
  const benchToGo = finite(b?.ydstogo);
  if (rowToGo != null && benchToGo != null) {
    const dd = Math.abs(rowToGo - benchToGo);
    if (dd <= 0.1) score += 4;
    else if (dd <= 1) score += 2;
    else return -Infinity;
  }

  const rowY100 = finite(record?.state?.yardline100);
  const benchY100 = finite(b?.yardline_100);
  if (rowY100 != null && benchY100 != null) {
    const dy = Math.abs(rowY100 - benchY100);
    if (dy <= 1) score += 5;
    else if (dy <= 2) score += 3;
    else if (dy <= 5) score += 1;
    else return -Infinity;
  }

  const rowDiff = finite(record?.state?.scoreDiff);
  const benchDiff = finite(b?.score_differential);
  if (rowDiff != null && benchDiff != null) {
    if (rowDiff === benchDiff) score += 3;
    else if (Math.abs(rowDiff - benchDiff) <= 3) score += 1;
  }

  return score;
}

export function matchBenchmarkRows(records, benchRows = []) {
  const matches = new Map();
  if (!Array.isArray(benchRows) || !benchRows.length) return matches;

  const exact = new Map(benchRows.map(r => [String(r.play_id), r]));
  const used = new Set();

  for (const record of records) {
    const playId = String(record?.decision?.playId || '');
    const hit = exact.get(playId);
    if (hit) {
      matches.set(record.id, { row: hit, method: 'PLAY_ID' });
      used.add(String(hit.play_id));
    }
  }

  for (const record of records) {
    if (matches.has(record.id)) continue;

    const candidates = benchRows
      .filter(b => !used.has(String(b.play_id)))
      .map(b => ({ b, score: benchmarkStateScore(record, b) }))
      .filter(x => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < 18) continue;
    if (second && second.score === best.score) continue;

    matches.set(record.id, { row: best.b, method: 'STATE_MATCH' });
    used.add(String(best.b.play_id));
  }

  return matches;
}

function referenceOptions(b = {}) {
  return {
    GO: finite(b?.go_wp),
    FG: finite(b?.fg_wp),
    PUNT: finite(b?.punt_wp)
  };
}

export function buildReferenceMatch(b, method = 'UNKNOWN') {
  const options = referenceOptions(b);
  const priced = Object.entries(options).filter(([, v]) => v != null);
  let optimal = String(b?.optimal || '').toUpperCase() || null;
  if (!optimal && priced.length) optimal = priced.slice().sort((a, c) => c[1] - a[1])[0][0];

  return {
    status: 'MATCHED',
    method,
    playId: b?.play_id != null ? String(b.play_id) : null,
    optimal,
    certainty: b?.certainty || null,
    edgePp: finite(b?.edge_pp),
    options
  };
}

export function referenceRegretPp(reference, action) {
  const options = reference?.options || {};
  const actual = finite(options?.[String(action || '').toUpperCase()]);
  const priced = Object.values(options).map(finite).filter(v => v != null);
  if (actual == null || !priced.length) return null;
  return 100 * (Math.max(...priced) - actual);
}

export function strongReferenceSplit(record) {
  const ref = record?.reference;
  if (ref?.status !== 'MATCHED') return false;
  const modelCall = String(record?.model?.v051?.optimal || '').toUpperCase();
  const refCall = String(ref?.optimal || '').toUpperCase();
  if (!modelCall || !refCall || modelCall === refCall) return false;

  const modelFragile = record?.model?.v051?.certainty === 'TOSS-UP';
  const refFragile = ref?.certainty === 'TOSS-UP' || (finite(ref?.edgePp) != null && finite(ref.edgePp) < 0.75);
  return !modelFragile && !refFragile;
}

function avg(xs) {
  const a = xs.map(finite).filter(v => v != null);
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}

function sum(xs) {
  return xs.map(finite).filter(v => v != null).reduce((s, v) => s + v, 0);
}

function pct(num, den) {
  return den ? num / den : null;
}

function teamSummary(team, rows) {
  const gradable = rows.filter(r => finite(r?.model?.v051?.wpRegretPp) != null && !['REVIEW','N/A'].includes(String(r?.model?.v051?.grade || '')));
  const agreement = gradable.filter(r => String(r.decision.actual) === String(r.model.v051.optimal)).length;
  const goActual = gradable.filter(r => r.decision.actual === 'GO').length;
  const goOptimal = gradable.filter(r => r.model.v051.optimal === 'GO').length;
  const burn = gradable.map(r => r.model.v051.wpRegretPp);
  return {
    team,
    decisions: rows.length,
    gradable: gradable.length,
    exactCoachModelAgreement: pct(agreement, gradable.length),
    totalModelWpaBurnPp: sum(burn),
    meanModelWpaBurnPp: avg(burn),
    costlyMistakes2Pp: gradable.filter(r => r.model.v051.wpRegretPp >= 2).length,
    catastrophicMistakes5Pp: gradable.filter(r => r.model.v051.wpRegretPp >= 5).length,
    actualGoRate: pct(goActual, gradable.length),
    modelGoRate: pct(goOptimal, gradable.length),
    aggressionDelta: pct(goActual - goOptimal, gradable.length),
    endgameDecisions: gradable.filter(r => r.model.v051.endgameActive).length
  };
}

function policyHealth(records, policy) {
  const gradable = records.filter(r => finite(r?.model?.v051?.wpRegretPp) != null);
  const referenceRows = records.filter(r => r?.reference?.status === 'MATCHED' && referenceRegretPp(r.reference, r.model.v051.optimal) != null);
  const endgameRef = referenceRows.filter(r => r?.model?.v051?.endgameActive);

  const mature = gradable.length >= policy.minimumSamplesBeforeModelChange.totalGradable &&
    referenceRows.length >= policy.minimumSamplesBeforeModelChange.referenceComparable &&
    endgameRef.length >= policy.minimumSamplesBeforeModelChange.endgameReferenceComparable;

  const refExact = pct(referenceRows.filter(r => r.model.v051.optimal === r.reference.optimal).length, referenceRows.length);
  const refRegrets = referenceRows.map(r => referenceRegretPp(r.reference, r.model.v051.optimal));
  const refSafe = pct(refRegrets.filter(x => x <= 0.75).length, refRegrets.length);
  const strongRate = pct(referenceRows.filter(strongReferenceSplit).length, referenceRows.length);
  const meanRegret = avg(refRegrets);

  const flips = referenceRows.filter(r => r.model?.legacy?.optimal && r.model.v051.optimal !== r.model.legacy.optimal);
  const flipDeltas = flips.map(r => {
    const legacy = referenceRegretPp(r.reference, r.model.legacy.optimal);
    const candidate = referenceRegretPp(r.reference, r.model.v051.optimal);
    if (legacy == null || candidate == null) return null;
    return legacy - candidate;
  }).filter(v => v != null);
  const flipNet = sum(flipDeltas);

  const tagHarm = new Map();
  for (const r of flips) {
    const legacy = referenceRegretPp(r.reference, r.model.legacy.optimal);
    const candidate = referenceRegretPp(r.reference, r.model.v051.optimal);
    if (legacy == null || candidate == null || candidate <= legacy) continue;
    const harm = candidate - legacy;
    for (const tag of r.model.v051.endgameTags || []) {
      const cur = tagHarm.get(tag) || { count: 0, harmPp: 0 };
      cur.count++;
      cur.harmPp += harm;
      tagHarm.set(tag, cur);
    }
  }

  const triggers = [];
  const t = policy.reviewTriggers;

  const catastrophic = referenceRows
    .map(r => ({ id: r.id, regret: referenceRegretPp(r.reference, r.model.v051.optimal) }))
    .filter(x => x.regret != null && x.regret >= t.singleReferenceRegretPpAtLeast);

  if (catastrophic.length) triggers.push({
    code: 'CATASTROPHIC_REFERENCE_MISS',
    severity: 'REVIEW',
    detail: `${catastrophic.length} prospective decision(s) at or above ${t.singleReferenceRegretPpAtLeast.toFixed(1)} pp reference regret.`
  });

  if (mature) {
    if (refExact != null && refExact < t.exactAgreementBelow) triggers.push({ code: 'EXACT_AGREEMENT_DRIFT', severity: 'RESEARCH', detail: `Exact agreement ${(100*refExact).toFixed(1)}% is below ${(100*t.exactAgreementBelow).toFixed(1)}%.` });
    if (refSafe != null && refSafe < t.decisionSafeRateBelow) triggers.push({ code: 'DECISION_SAFE_DRIFT', severity: 'RESEARCH', detail: `Decision-safe ${(100*refSafe).toFixed(1)}% is below ${(100*t.decisionSafeRateBelow).toFixed(1)}%.` });
    if (meanRegret != null && meanRegret > t.meanReferenceRegretPpAbove) triggers.push({ code: 'MEAN_REGRET_DRIFT', severity: 'RESEARCH', detail: `Mean reference regret ${meanRegret.toFixed(3)} pp exceeds ${t.meanReferenceRegretPpAbove.toFixed(3)} pp.` });
    if (strongRate != null && strongRate > t.strongSplitRateAbove) triggers.push({ code: 'STRONG_SPLIT_DRIFT', severity: 'RESEARCH', detail: `Strong split rate ${(100*strongRate).toFixed(1)}% exceeds ${(100*t.strongSplitRateAbove).toFixed(1)}%.` });
    if (flips.length >= t.v051VsLegacyMinimumFlipsForNetTrigger && flipNet < t.v051VsLegacyNetReferenceRegretSavedPpBelow) triggers.push({ code: 'V051_LOSES_TO_LEGACY_ON_FLIPS', severity: 'RESEARCH', detail: `Across ${flips.length} v0.5.1/legacy flips, net reference regret saved is ${flipNet.toFixed(2)} pp.` });

    for (const [tag, stat] of tagHarm) {
      if (stat.count >= t.sameDiagnosticTagHarmfulCountAtLeast && stat.harmPp >= t.sameDiagnosticTagCumulativeHarmPpAtLeast) {
        triggers.push({ code: 'REPEATED_TAG_FAILURE', severity: 'RESEARCH', detail: `${tag}: ${stat.count} harmful flips, ${stat.harmPp.toFixed(2)} pp cumulative harm.` });
      }
    }
  }

  let state = 'LOCKED_SAMPLE';
  let headline = `Freeze remains locked: ${gradable.length}/${policy.minimumSamplesBeforeModelChange.totalGradable} gradable, ${referenceRows.length}/${policy.minimumSamplesBeforeModelChange.referenceComparable} reference-comparable.`;
  if (catastrophic.length) {
    state = 'REVIEW';
    headline = 'Immediate review signal detected. Do not retune from a single event.';
  }
  if (mature && !triggers.length) {
    state = 'STABLE';
    headline = 'Minimum prospective sample reached with no preregistered drift trigger.';
  } else if (mature && triggers.length) {
    state = 'V06_RESEARCH_ELIGIBLE';
    headline = 'Preregistered 2026 drift trigger reached. Investigate before designing v0.6.';
  }

  return {
    state,
    headline,
    mature,
    triggers,
    referenceMetrics: {
      exactAgreement: refExact,
      decisionSafeRate: refSafe,
      meanReferenceRegretPp: meanRegret,
      strongSplitRate: strongRate,
      comparable: referenceRows.length,
      endgameComparable: endgameRef.length,
      v051VsLegacy: {
        flips: flips.length,
        netReferenceRegretSavedPp: flipNet
      }
    }
  };
}

export function buildSummary(records, policy, meta = {}) {
  const rows = [...records].sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  const gradable = rows.filter(r => finite(r?.model?.v051?.wpRegretPp) != null);
  const referenceRows = rows.filter(r => r?.reference?.status === 'MATCHED');
  const health = policyHealth(rows, policy);

  const byTeam = new Map();
  for (const r of rows) {
    const team = r?.offense?.abbreviation || 'UNK';
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(r);
  }

  const teams = [...byTeam.entries()]
    .map(([team, teamRows]) => teamSummary(team, teamRows))
    .sort((a, b) => b.totalModelWpaBurnPp - a.totalModelWpaBurnPp);

  const biggestMistakes = gradable
    .slice()
    .sort((a, b) => b.model.v051.wpRegretPp - a.model.v051.wpRegretPp)
    .slice(0, 30)
    .map(r => ({
      id: r.id,
      eventId: r.game.eventId,
      gameName: r.game.name,
      offense: r.offense.abbreviation,
      defense: r.defense.abbreviation,
      quarter: r.state.quarter,
      clock: r.state.clock,
      ydstogo: r.state.ydstogo,
      yardline100: r.state.yardline100,
      scoreDiff: r.state.scoreDiff,
      actual: r.decision.actual,
      optimal: r.model.v051.optimal,
      grade: r.model.v051.grade,
      modelWpaBurnPp: r.model.v051.wpRegretPp,
      certainty: r.model.v051.certainty,
      endgameTags: r.model.v051.endgameTags,
      description: r.outcome.text,
      referenceOptimal: r.reference?.status === 'MATCHED' ? r.reference.optimal : null,
      referenceRegretPp: r.reference?.status === 'MATCHED' ? referenceRegretPp(r.reference, r.model.v051.optimal) : null
    }));

  const pipelineCounts = { READY: 0, DATA_UNAVAILABLE: 0, GAME_NOT_FOUND: 0, PIPELINE_ERROR: 0, NO_MATCH: 0, UNKNOWN: 0 };
  const seenGames = new Map();
  for (const r of rows) {
    if (!seenGames.has(r.game.eventId)) seenGames.set(r.game.eventId, r.referencePipeline || { code: 'UNKNOWN' });
  }
  for (const s of seenGames.values()) {
    const code = String(s?.code || 'UNKNOWN');
    if (code in pipelineCounts) pipelineCounts[code]++;
    else pipelineCounts.UNKNOWN++;
  }

  const referenceMetrics = health.referenceMetrics;
  return {
    schemaVersion: 1,
    season: 2026,
    status: rows.length ? 'ACTIVE' : 'WAITING_FOR_ELIGIBLE_GAMES',
    monitorStartAt: policy.monitorStartAt,
    releaseTag: policy.releaseTag,
    lastMaterialUpdateAt: meta.lastMaterialUpdateAt || null,
    productionHealth: meta.productionHealth || null,
    sample: {
      archived: rows.length,
      gradable: gradable.length,
      referenceComparable: referenceMetrics.comparable,
      endgameReferenceComparable: referenceMetrics.endgameComparable
    },
    maturity: {
      totalGradableTarget: policy.minimumSamplesBeforeModelChange.totalGradable,
      referenceComparableTarget: policy.minimumSamplesBeforeModelChange.referenceComparable,
      endgameReferenceComparableTarget: policy.minimumSamplesBeforeModelChange.endgameReferenceComparable
    },
    modelHealth: {
      state: health.state,
      headline: health.headline,
      mature: health.mature,
      triggers: health.triggers
    },
    reference: {
      available: referenceMetrics.comparable > 0,
      exactAgreement: referenceMetrics.exactAgreement,
      decisionSafeRate: referenceMetrics.decisionSafeRate,
      meanReferenceRegretPp: referenceMetrics.meanReferenceRegretPp,
      strongSplitRate: referenceMetrics.strongSplitRate,
      v051VsLegacy: referenceMetrics.v051VsLegacy
    },
    coachModel: {
      meanModelWpaBurnPp: avg(gradable.map(r => r.model.v051.wpRegretPp)),
      totalModelWpaBurnPp: sum(gradable.map(r => r.model.v051.wpRegretPp)),
      exactCoachModelAgreement: pct(gradable.filter(r => r.decision.actual === r.model.v051.optimal).length, gradable.length),
      actualGoRate: pct(gradable.filter(r => r.decision.actual === 'GO').length, gradable.length),
      modelGoRate: pct(gradable.filter(r => r.model.v051.optimal === 'GO').length, gradable.length)
    },
    benchmarkPipeline: pipelineCounts,
    teams,
    biggestMistakes,
    recent: rows.slice(0, 40).map(r => ({
      id: r.id,
      capturedAt: r.capturedAt,
      gameName: r.game.name,
      kickoff: r.game.kickoff,
      offense: r.offense.abbreviation,
      defense: r.defense.abbreviation,
      quarter: r.state.quarter,
      clock: r.state.clock,
      ydstogo: r.state.ydstogo,
      yardline100: r.state.yardline100,
      scoreDiff: r.state.scoreDiff,
      actual: r.decision.actual,
      optimal: r.model.v051.optimal,
      grade: r.model.v051.grade,
      modelWpaBurnPp: r.model.v051.wpRegretPp,
      certainty: r.model.v051.certainty,
      referenceStatus: r.reference?.status || r.referencePipeline?.code || 'PENDING',
      referenceOptimal: r.reference?.optimal || null,
      endgameTags: r.model.v051.endgameTags
    }))
  };
}
