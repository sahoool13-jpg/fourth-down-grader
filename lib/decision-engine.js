/**
 * Fourth Down Decision Engine v0.3
 *
 * Counterfactual GO / FG / PUNT model with:
 * - modern empirical conversion and kick anchors
 * - game-state win probability
 * - optional live baseline anchoring (e.g. ESPN pre-play WP)
 * - late-game possession / clock logic
 * - sensitivity analysis and robustness labels
 * - deterministic explanation drivers
 *
 * This is NOT nfl4th and must not be represented as nfl4th output.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(clamp(p, 0.001, 0.999) / (1 - clamp(p, 0.001, 0.999)));

const CONVERSION_ANCHORS = [
  [0.25, 0.80], [0.5, 0.77], [1.0, 0.70], [1.5, 0.63],
  [2.0, 0.57], [3.0, 0.515], [4.0, 0.485], [5.0, 0.437],
  [6.0, 0.418], [7.0, 0.381], [8.0, 0.347], [9.0, 0.305],
  [10.0, 0.285], [12.0, 0.235], [15.0, 0.15], [20.0, 0.10]
];

const FG_ANCHORS = [
  [20, 0.995], [25, 0.98], [30, 0.96], [35, 0.925], [40, 0.86],
  [45, 0.79], [50, 0.715], [55, 0.65], [58, 0.58], [60, 0.50],
  [62, 0.39], [65, 0.30], [68, 0.20], [70, 0.12]
];

const EP_ANCHORS = [
  [1, 6.05], [5, 5.45], [10, 4.70], [20, 3.65], [30, 2.75],
  [40, 2.05], [50, 1.45], [60, 1.02], [70, 0.68], [80, 0.34],
  [90, 0.02], [99, -0.55]
].sort((a, b) => a[0] - b[0]);

function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points.at(-1)[0]) return points.at(-1)[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (x <= x2) {
      const t = (x - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return points.at(-1)[1];
}

export function conversionProbability({ ydstogo, offenseAdjustment = 0, defenseAdjustment = 0 }) {
  const base = interpolate(CONVERSION_ANCHORS, clamp(Number(ydstogo), 0.1, 30));
  return clamp(sigmoid(logit(base) + Number(offenseAdjustment || 0) - Number(defenseAdjustment || 0)), 0.03, 0.95);
}

export function fieldGoalProbability({ kickDistance, kickerAdjustment = 0, weatherAdjustment = 0, indoor = false }) {
  const base = interpolate(FG_ANCHORS, clamp(Number(kickDistance), 18, 75));
  const indoorBoost = indoor ? 0.06 : 0;
  return clamp(sigmoid(logit(base) + Number(kickerAdjustment || 0) + Number(weatherAdjustment || 0) + indoorBoost), 0.01, 0.997);
}

export function expectedPointsAt(yardline100) {
  return interpolate(EP_ANCHORS, clamp(Number(yardline100), 1, 99));
}

/**
 * Lightweight WP model from the offense's perspective.
 * Live mode can anchor this state to an external pre-play WP estimate.
 */
export function stateWinProbability({
  scoreDiff = 0,
  secondsRemaining = 1800,
  yardline100 = 50,
  timeouts = 3,
  opponentTimeouts = 3,
  strengthAdjustment = 0
}) {
  const sec = clamp(Number(secondsRemaining), 0, 3600);
  const sd = Number(scoreDiff || 0);
  if (sec <= 0) return sd > 0 ? 0.999 : sd < 0 ? 0.001 : 0.5;

  const ep = expectedPointsAt(yardline100);
  const late = 1 - sec / 3600;
  const possessionWeight = 0.72 + 0.24 * late;
  let effectiveMargin = sd + ep * possessionWeight + Number(strengthAdjustment || 0);

  // Football scores arrive in chunks, not continuously. A smooth margin-only model
  // badly misprices late states such as down 20: a FG (down 17) still leaves three
  // scoring possessions, while a TD (down 13) reduces the requirement to two.
  // Add a possession-class term that grows as the clock expires.
  if (sec < 1200 && sd !== 0) {
    const urgency = (1200 - sec) / 1200;
    const scoringPossessions = Math.max(1, Math.ceil(Math.abs(sd) / 8));
    const classValue = (scoringPossessions - 1) * (1.35 + 4.25 * urgency);
    effectiveMargin += sd > 0 ? classValue : -classValue;
  }

  if (sec < 900) {
    const timeoutLeverage = (900 - sec) / 900;
    effectiveMargin += (Number(timeouts) - Number(opponentTimeouts)) * 0.34 * timeoutLeverage;
  }

  // Lower uncertainty as the game expires. This intentionally steepens score value late.
  const scale = 2.35 + 10.5 * Math.sqrt(sec / 3600);
  return clamp(sigmoid(effectiveMargin / scale), 0.001, 0.999);
}

function normalizeInput(input = {}) {
  return {
    ydstogo: clamp(Number(input.ydstogo ?? 1), 0.1, 50),
    yardline100: clamp(Number(input.yardline100 ?? 50), 1, 99),
    scoreDiff: Number(input.scoreDiff ?? 0),
    secondsRemaining: clamp(Number(input.secondsRemaining ?? 1800), 0, 3600),
    timeouts: clamp(Number(input.timeouts ?? 3), 0, 3),
    opponentTimeouts: clamp(Number(input.opponentTimeouts ?? 3), 0, 3),
    indoor: Boolean(input.indoor),
    offenseAdjustment: Number(input.offenseAdjustment ?? 0),
    defenseAdjustment: Number(input.defenseAdjustment ?? 0),
    kickerAdjustment: Number(input.kickerAdjustment ?? 0),
    weatherAdjustment: Number(input.weatherAdjustment ?? 0),
    punterAdjustment: Number(input.punterAdjustment ?? 0),
    strengthAdjustment: Number(input.strengthAdjustment ?? 0),
    maxFgDistance: clamp(Number(input.maxFgDistance ?? 68), 50, 75),
    baselineWp: input.baselineWp != null && Number.isFinite(Number(input.baselineWp)) ? clamp(Number(input.baselineWp), 0.001, 0.999) : null
  };
}

function opponentPossessionWpForOriginal({ scoreDiff, secondsRemaining, opponentYardline100, timeouts, opponentTimeouts, strengthAdjustment = 0 }) {
  const oppWp = stateWinProbability({
    scoreDiff: -scoreDiff,
    secondsRemaining,
    yardline100: opponentYardline100,
    timeouts: opponentTimeouts,
    opponentTimeouts: timeouts,
    strengthAdjustment: -strengthAdjustment
  });
  let originalWp = 1 - oppWp;

  // A generic state model tends to underprice possession scarcity late. When the
  // original offense is trailing, voluntarily yielding the ball has an extra clock cost
  // because the opponent can consume downs before the offense gets another possession.
  if (scoreDiff < 0 && secondsRemaining < 1200) {
    // Giving the ball away while trailing burns not just field position but a scarce
    // possession. This cost begins before pure desperation time and steepens late.
    const urgency = (1200 - secondsRemaining) / 1200;
    const scoresBehind = Math.min(4, Math.max(1, Math.ceil(Math.abs(scoreDiff) / 8)));
    const shift = (0.28 + 0.22 * scoresBehind) * Math.pow(urgency, 1.25);
    originalWp = sigmoid(logit(originalWp) - shift);
  }

  return clamp(originalWp, 0.001, 0.999);
}

function kickoffWpForOriginal({ newScoreDiff, secondsRemaining, timeouts, opponentTimeouts, strengthAdjustment = 0 }) {
  // Modern kickoffs generally yield a normal starting possession around own 30.
  return opponentPossessionWpForOriginal({
    scoreDiff: newScoreDiff,
    secondsRemaining,
    opponentYardline100: 70,
    timeouts,
    opponentTimeouts,
    strengthAdjustment
  });
}

function expectedPuntOpponentYardline100(s, puntYardDelta = 0) {
  // Field compression: net distance shrinks in plus territory because punts cannot use the end zone.
  const compressedNet = Math.min(42.5 + s.punterAdjustment, 0.75 * s.yardline100 + s.punterAdjustment);
  return clamp(100 - s.yardline100 + compressedNet + puntYardDelta, 30, 96);
}

function lateLeadSuccessFloor(s, afterPlaySeconds) {
  if (s.scoreDiff <= 0 || afterPlaySeconds <= 0) return null;
  // Fresh first down while leading can turn directly into a clock-kill sequence.
  // Each opponent timeout removes roughly one 40-second runoff window.
  const runoff = Math.max(0, (3 - s.opponentTimeouts) * 40 + 8);
  if (afterPlaySeconds <= runoff) return 0.997;
  if (afterPlaySeconds <= runoff + 30) return 0.985;
  if (afterPlaySeconds <= runoff + 60) return 0.955;
  return null;
}

function anchorWp(rawBase, rawOption, baselineWp) {
  if (baselineWp == null) return rawOption;
  const delta = logit(rawOption) - logit(rawBase);
  // Slight shrinkage avoids pretending our structural counterfactual delta is perfectly calibrated.
  return clamp(sigmoid(logit(baselineWp) + 0.90 * delta), 0.001, 0.999);
}

function computeOptions(s, tweaks = {}) {
  const pConvert = clamp(conversionProbability(s) + Number(tweaks.convertDelta || 0), 0.02, 0.97);
  const playSeconds = s.secondsRemaining < 180 ? 5 : 6;
  const afterPlaySeconds = Math.max(0, s.secondsRemaining - playSeconds);
  const rawBase = stateWinProbability(s);

  // Success is not assumed to stop exactly at the sticks. Use modest YAC beyond the line to gain.
  const successGain = Math.min(s.yardline100, s.ydstogo + (s.ydstogo <= 2 ? 1.7 : 2.8));
  const touchdown = successGain >= s.yardline100;
  let rawWpSuccess;
  if (touchdown) {
    rawWpSuccess = kickoffWpForOriginal({
      newScoreDiff: s.scoreDiff + 7,
      secondsRemaining: afterPlaySeconds,
      timeouts: s.timeouts,
      opponentTimeouts: s.opponentTimeouts,
      strengthAdjustment: s.strengthAdjustment
    });
  } else if (lateLeadSuccessFloor(s, afterPlaySeconds) != null) {
    rawWpSuccess = Math.max(lateLeadSuccessFloor(s, afterPlaySeconds), stateWinProbability({ ...s, secondsRemaining: afterPlaySeconds, yardline100: Math.max(1, s.yardline100 - successGain) }));
  } else {
    rawWpSuccess = stateWinProbability({
      ...s,
      secondsRemaining: afterPlaySeconds,
      yardline100: Math.max(1, s.yardline100 - successGain)
    });
  }

  // Failed fourth down: opponent takes over at the spot.
  const rawWpFail = opponentPossessionWpForOriginal({
    scoreDiff: s.scoreDiff,
    secondsRemaining: afterPlaySeconds,
    opponentYardline100: 100 - s.yardline100,
    timeouts: s.timeouts,
    opponentTimeouts: s.opponentTimeouts,
    strengthAdjustment: s.strengthAdjustment
  });
  const rawGoWp = pConvert * rawWpSuccess + (1 - pConvert) * rawWpFail;

  // Field goal.
  const kickDistance = s.yardline100 + 17;
  const fgAvailable = kickDistance <= s.maxFgDistance && s.yardline100 <= 58;
  let pFg = null;
  let rawFgWp = null;
  let rawWpFgMake = null;
  let rawWpFgMiss = null;
  if (fgAvailable) {
    pFg = clamp(fieldGoalProbability({ ...s, kickDistance }) + Number(tweaks.fgDelta || 0), 0.005, 0.999);
    const fgSeconds = Math.max(0, s.secondsRemaining - 5);
    rawWpFgMake = kickoffWpForOriginal({
      newScoreDiff: s.scoreDiff + 3,
      secondsRemaining: fgSeconds,
      timeouts: s.timeouts,
      opponentTimeouts: s.opponentTimeouts,
      strengthAdjustment: s.strengthAdjustment
    });

    // Missed FG spot approximation: opponent receives around the spot of the kick / LOS rules.
    const missOriginalYardline100 = Math.min(99, s.yardline100 + 7);
    rawWpFgMiss = opponentPossessionWpForOriginal({
      scoreDiff: s.scoreDiff,
      secondsRemaining: fgSeconds,
      opponentYardline100: 100 - missOriginalYardline100,
      timeouts: s.timeouts,
      opponentTimeouts: s.opponentTimeouts,
      strengthAdjustment: s.strengthAdjustment
    });
    rawFgWp = pFg * rawWpFgMake + (1 - pFg) * rawWpFgMiss;
  }

  // Punt.
  const opponentYardline100 = expectedPuntOpponentYardline100(s, Number(tweaks.puntYardDelta || 0));
  const puntSeconds = Math.max(0, s.secondsRemaining - 8);
  const rawPuntWp = opponentPossessionWpForOriginal({
    scoreDiff: s.scoreDiff,
    secondsRemaining: puntSeconds,
    opponentYardline100,
    timeouts: s.timeouts,
    opponentTimeouts: s.opponentTimeouts,
    strengthAdjustment: s.strengthAdjustment
  });

  const goWp = anchorWp(rawBase, rawGoWp, s.baselineWp);
  const puntWp = anchorWp(rawBase, rawPuntWp, s.baselineWp);
  const fgWp = fgAvailable ? anchorWp(rawBase, rawFgWp, s.baselineWp) : null;

  return {
    rawBase,
    baseWp: s.baselineWp ?? rawBase,
    pConvert,
    pFg,
    kickDistance,
    fgAvailable,
    opponentYardline100,
    wpSuccess: anchorWp(rawBase, rawWpSuccess, s.baselineWp),
    wpFail: anchorWp(rawBase, rawWpFail, s.baselineWp),
    wpFgMake: fgAvailable ? anchorWp(rawBase, rawWpFgMake, s.baselineWp) : null,
    wpFgMiss: fgAvailable ? anchorWp(rawBase, rawWpFgMiss, s.baselineWp) : null,
    options: {
      GO: goWp,
      PUNT: puntWp,
      ...(fgAvailable ? { FG: fgWp } : {})
    }
  };
}

export function gradeLetter(wpRegret) {
  const pct = Number(wpRegret || 0) * 100;
  if (pct <= 0.05) return 'A+';
  if (pct <= 0.5) return 'A';
  if (pct <= 1.5) return 'B';
  if (pct <= 3.0) return 'C';
  if (pct <= 5.0) return 'D';
  return 'F';
}

function sensitivityAnalysis(s, baseResult) {
  const scenarios = [
    {},
    { convertDelta: -0.04 }, { convertDelta: 0.04 },
    { fgDelta: -0.04 }, { fgDelta: 0.04 },
    { puntYardDelta: -4 }, { puntYardDelta: 4 },
    { convertDelta: -0.03, fgDelta: 0.03, puntYardDelta: 3 },
    { convertDelta: 0.03, fgDelta: -0.03, puntYardDelta: -3 }
  ];

  const ranges = {};
  let sameWinner = 0;
  const winners = [];
  for (const sc of scenarios) {
    const r = computeOptions(s, sc);
    const entries = Object.entries(r.options).sort((a, b) => b[1] - a[1]);
    const winner = entries[0][0];
    winners.push(winner);
    if (winner === baseResult.optimal) sameWinner++;
    for (const [d, wp] of entries) {
      ranges[d] ||= [wp, wp];
      ranges[d][0] = Math.min(ranges[d][0], wp);
      ranges[d][1] = Math.max(ranges[d][1], wp);
    }
  }
  const robustness = sameWinner / scenarios.length;
  const confidence = robustness >= 0.89 ? 'HIGH' : robustness >= 0.67 ? 'MEDIUM' : 'LOW';
  return { robustness, confidence, ranges, winners };
}

export function certaintyLabel(edge, robustness = 1) {
  const pct = edge * 100;
  if (pct >= 2.0 && robustness >= 0.67) return 'CLEAR';
  if (pct >= 0.75 && robustness >= 0.55) return 'LEAN';
  return 'TOSS-UP';
}

function buildDrivers(s, r, optimal, sensitivity) {
  const drivers = [];
  if (s.ydstogo <= 1.0) drivers.push(`Very short yardage: estimated conversion probability ${(r.pConvert * 100).toFixed(0)}%.`);
  else if (s.ydstogo <= 3) drivers.push(`Manageable ${s.ydstogo.toFixed(s.ydstogo % 1 ? 1 : 0)} yards to gain keeps GO live.`);
  else if (s.ydstogo >= 7) drivers.push(`Long conversion distance suppresses the GO option.`);

  if (s.yardline100 >= 35 && s.yardline100 <= 52) drivers.push(`No-man's-land field position reduces the value of both a punt and a long kick.`);
  if (s.yardline100 <= 4 && optimal === 'GO') drivers.push(`Goal-line failure is partially cushioned because the opponent would inherit terrible field position.`);

  if (s.scoreDiff < 0 && s.secondsRemaining <= 600) drivers.push(`Late-game possession scarcity: giving the ball away while trailing is unusually expensive.`);
  if (s.scoreDiff > 0 && s.secondsRemaining <= 180 && optimal === 'GO') drivers.push(`A conversion can materially reduce or eliminate the opponent's chance to get the ball back.`);

  if (r.fgAvailable && r.kickDistance <= 45 && optimal === 'FG') drivers.push(`Short-to-medium field-goal distance creates a high-value three-point option.`);
  if (r.fgAvailable && r.kickDistance >= 55) drivers.push(`Long field-goal distance adds meaningful miss risk.`);
  if (!r.fgAvailable) drivers.push(`Field goal is outside the configured maximum range.`);

  if (s.baselineWp != null) drivers.push(`Live WP anchor calibrates the model to the actual game state before applying counterfactual deltas.`);
  if (sensitivity.confidence === 'LOW') drivers.push(`Recommendation is fragile: reasonable assumption changes can flip the preferred call.`);
  return drivers.slice(0, 4);
}

export function evaluateFourthDown(input = {}) {
  const s = normalizeInput(input);
  const core = computeOptions(s);
  const entries = Object.entries(core.options).sort((a, b) => b[1] - a[1]);
  const optimal = entries[0][0];
  const edge = entries[0][1] - entries[1][1];
  const baseResult = { optimal, edge };
  const sensitivity = sensitivityAnalysis(s, baseResult);
  const certainty = certaintyLabel(edge, sensitivity.robustness);

  return {
    modelVersion: 'v0.3-anchored-counterfactual',
    modelStatus: s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored',
    input: s,
    optimal,
    certainty,
    edge,
    options: core.options,
    baselineWp: core.baseWp,
    diagnostics: {
      firstDownProbability: core.pConvert,
      wpSuccess: core.wpSuccess,
      wpFail: core.wpFail,
      fgMakeProbability: core.fgAvailable ? core.pFg : null,
      kickDistance: core.fgAvailable ? core.kickDistance : null,
      expectedOpponentYardlineAfterPunt: core.opponentYardline100,
      liveAnchorUsed: s.baselineWp != null
    },
    sensitivity: {
      robustness: sensitivity.robustness,
      confidence: sensitivity.confidence,
      optionRanges: Object.fromEntries(Object.entries(sensitivity.ranges).map(([k, [lo, hi]]) => [k, { low: lo, high: hi }]))
    },
    drivers: buildDrivers(s, core, optimal, sensitivity)
  };
}

export function gradeActualDecision(evaluation, actualDecision) {
  const actual = String(actualDecision || '').toUpperCase();
  const actualWp = evaluation.options[actual];
  if (actualWp == null) return { ...evaluation, actual, grade: 'N/A', wpRegret: null };
  const optimalWp = evaluation.options[evaluation.optimal];
  const regret = Math.max(0, optimalWp - actualWp);
  let grade = gradeLetter(regret);
  // If the model itself labels the choice TOSS-UP, a large punitive letter grade would
  // contradict the uncertainty statement. Keep the center-estimate WPA burn visible,
  // but cap the letter grade at B for a non-optimal choice inside a fragile state.
  if (evaluation.certainty === 'TOSS-UP' && ['C', 'D', 'F'].includes(grade)) grade = 'B';
  return {
    ...evaluation,
    actual,
    actualWp,
    optimalWp,
    wpRegret: regret,
    grade,
    gradeNote: evaluation.certainty === 'TOSS-UP' && actual !== evaluation.optimal
      ? 'Center estimate differs, but the recommendation is inside the model uncertainty band.'
      : null
  };
}

/**
 * Third-down planning helper. Finds how much a team must gain on third down
 * for the resulting fourth down to become a GO recommendation.
 */
export function evaluateThirdDownPlanning(input = {}) {
  const third = normalizeInput(input);
  const thirdDistance = clamp(Number(input.ydstogo ?? 6), 1, 30);
  const afterSec = Math.max(0, third.secondsRemaining - 6);
  let requiredGain = null;
  let resulting = null;

  for (let gain = 0; gain < thirdDistance; gain += 0.5) {
    const remain = Math.max(0.25, thirdDistance - gain);
    const ev = evaluateFourthDown({
      ...third,
      baselineWp: null,
      secondsRemaining: afterSec,
      ydstogo: remain,
      yardline100: Math.max(1, third.yardline100 - gain)
    });
    if (ev.optimal === 'GO') {
      requiredGain = gain;
      resulting = ev;
      break;
    }
  }

  if (requiredGain == null) {
    return {
      twoDownTerritory: false,
      requiredGain: null,
      message: `No realistic failed-third-down gain creates a clear GO state in this model.`
    };
  }

  const remainingDistance = Math.max(0.25, thirdDistance - requiredGain);
  return {
    twoDownTerritory: true,
    requiredGain,
    remainingDistance,
    certainty: resulting.certainty,
    message: requiredGain <= 0.01
      ? `Already two-down territory: even no gain leaves a model-preferred fourth-down attempt.`
      : `Gain about ${requiredGain.toFixed(requiredGain % 1 ? 1 : 0)}+ yards and a failed third down projects to 4th & ${remainingDistance.toFixed(remainingDistance % 1 ? 1 : 0)}, where GO becomes preferred.`
  };
}
