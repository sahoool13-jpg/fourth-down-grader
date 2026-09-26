/**
 * 4TH DOWN v0.5.1 — Gated Endgame Intelligence
 *
 * Revision of v0.5 after the locked 2021–2024 development audit.
 * Strong endgame corrections are now reserved for genuinely terminal states.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(clamp(Number(p), 0.001, 0.999) / (1 - clamp(Number(p), 0.001, 0.999)));
const shiftWp = (wp, shift) => wp == null ? null : clamp(sigmoid(logit(wp) + shift), 0.001, 0.999);

function rampDown(seconds, window) {
  return clamp((window - Number(seconds)) / window, 0, 1);
}

function addDriver(drivers, text) {
  if (!drivers.includes(text)) drivers.push(text);
}

function fgReliability(pFg, kickDistance) {
  if (!Number.isFinite(pFg) || !Number.isFinite(kickDistance)) return 0;
  const prob = clamp((pFg - 0.58) / 0.30, 0, 1);
  const dist = clamp((61 - kickDistance) / 8, 0, 1);
  return Math.min(prob, dist);
}

export function endgameContext(s, ctx = {}) {
  const sec = Number(s.secondsRemaining);
  const score = Number(s.scoreDiff);
  const deficit = Math.max(0, -score);
  const lead = Math.max(0, score);
  const pFg = ctx.pFg == null ? null : Number(ctx.pFg);
  const kickDistance = ctx.kickDistance == null ? null : Number(ctx.kickDistance);
  const fgResultDiff = score + 3;

  return {
    active: sec <= 300,
    terminal: sec <= 120,
    ultraTerminal: sec <= 60,
    lateThree: sec <= 180,
    secondsRemaining: sec,
    scoreDiff: score,
    deficit,
    lead,
    fgResultDiff,
    fgAvailable: Boolean(ctx.fgAvailable),
    pFg,
    kickDistance,
    fgReliability: fgReliability(pFg, kickDistance),
    urgency5: rampDown(sec, 300),
    urgency3: rampDown(sec, 180),
    urgency2: rampDown(sec, 120),
    urgency60: rampDown(sec, 60),
    offenseTimeouts: Number(s.timeouts),
    opponentTimeouts: Number(s.opponentTimeouts),
    ydstogo: Number(s.ydstogo),
    yardline100: Number(s.yardline100)
  };
}

export function applyEndgameIntelligence(s, ctx = {}) {
  const options = {
    GO: ctx.options?.GO ?? null,
    FG: ctx.options?.FG ?? null,
    PUNT: ctx.options?.PUNT ?? null
  };
  const c = endgameContext(s, ctx);
  const shifts = { GO: 0, FG: 0, PUNT: 0 };
  const drivers = [];
  const tags = [];

  if (!s.endgameEnabled || !c.active) {
    return { active: false, context: c, shifts, options, drivers, tags };
  }

  // 1) Possession scarcity, concentrated inside two minutes.
  if (c.scoreDiff < 0) {
    let puntPenalty = 0;

    if (c.secondsRemaining <= 60) {
      puntPenalty = 0.42 + 0.36 * c.urgency60;
      if (c.offenseTimeouts === 0) puntPenalty += 0.12;
    } else if (c.secondsRemaining <= 120) {
      puntPenalty = 0.18 + 0.22 * c.urgency2;
      if (c.offenseTimeouts === 0) puntPenalty += 0.10;
    } else if (c.secondsRemaining <= 180 && (c.offenseTimeouts === 0 || c.deficit >= 9)) {
      puntPenalty = 0.06 + 0.08 * c.urgency3;
    }

    if (c.deficit >= 9 && c.secondsRemaining <= 120) puntPenalty += 0.10;

    if (puntPenalty > 0) {
      shifts.PUNT -= puntPenalty;
      addDriver(drivers, 'Late-game possession scarcity reduces the value of voluntarily giving the ball away while trailing.');
      tags.push('TRAILING_PUNT_SCARCITY');
    }
  }

  // 2) If a FG still leaves the offense behind, discount it.
  if (c.scoreDiff < 0 && c.deficit >= 4 && c.fgAvailable && c.fgResultDiff < 0) {
    const residualDeficit = Math.abs(c.fgResultDiff);
    let fgPenalty = 0;
    let goBoost = 0;

    if (c.secondsRemaining <= 60) {
      fgPenalty = 0.72 + 0.10 * Math.min(residualDeficit, 8);
      goBoost = 0.22;
    } else if (c.secondsRemaining <= 120) {
      fgPenalty = 0.46 + 0.06 * Math.min(residualDeficit, 8);
      goBoost = 0.14;
    } else if (c.secondsRemaining <= 180) {
      fgPenalty = 0.22;
      goBoost = 0.06;
    } else if (c.deficit >= 9) {
      fgPenalty = 0.08;
      goBoost = 0.02;
    }

    shifts.FG -= fgPenalty;
    shifts.GO += goBoost;

    if (fgPenalty > 0) {
      addDriver(drivers, 'A field goal still leaves the offense behind, so its terminal value is discounted.');
      tags.push('FG_DOES_NOT_TIE_OR_LEAD');
      if (c.secondsRemaining <= 180) {
        addDriver(drivers, 'The offense still needs touchdown value, so preserving the conversion path matters more as possessions disappear.');
        tags.push('MUST_TD_PATH');
      }
    }
  }

  // 3) Go-ahead FG boost requires credible kick reliability.
  if (
    c.fgAvailable &&
    c.pFg != null &&
    c.fgResultDiff > 0 &&
    c.scoreDiff >= -2 &&
    c.scoreDiff <= 0 &&
    c.fgReliability > 0
  ) {
    let fgLeadBoost = 0;

    if (c.secondsRemaining <= 60) {
      fgLeadBoost = (0.44 + 0.18 * c.urgency60) * c.fgReliability;
    } else if (c.secondsRemaining <= 120) {
      fgLeadBoost = (0.24 + 0.12 * c.urgency2) * c.fgReliability;
    } else if (c.secondsRemaining <= 180 && c.fgReliability >= 0.65) {
      fgLeadBoost = 0.08 * c.fgReliability;
    }

    if (fgLeadBoost > 0) {
      shifts.FG += fgLeadBoost;
      addDriver(drivers, 'A credible field goal can take the lead in a terminal scoring window.');
      tags.push('FG_TAKES_LEAD');
      if (c.scoreDiff === 0) tags.push('TIED_FG_WINDOW');
    }
  }

  // 4) A tying FG is a smaller intervention and is blocked on short yardage.
  if (
    c.fgAvailable &&
    c.pFg != null &&
    c.fgResultDiff === 0 &&
    c.fgReliability > 0 &&
    c.ydstogo >= 4
  ) {
    let fgTieBoost = 0;

    if (c.secondsRemaining <= 60 && c.fgReliability >= 0.55) {
      fgTieBoost = 0.18 * c.fgReliability;
    } else if (c.secondsRemaining <= 120 && c.fgReliability >= 0.75) {
      fgTieBoost = 0.08 * c.fgReliability;
    }

    if (fgTieBoost > 0) {
      shifts.FG += fgTieBoost;
      addDriver(drivers, 'A highly reliable field goal preserves the tie when the alternative conversion is not short.');
      tags.push('FG_TIES_GAME');
    }
  }

  // 5) Protect a late lead, but with a small cap.
  if (c.scoreDiff > 0 && c.secondsRemaining <= 150 && c.ydstogo <= 3) {
    const timeoutEdge = clamp((2 - c.opponentTimeouts) / 2, 0, 1);
    const goBoost = (0.06 + 0.14 * rampDown(c.secondsRemaining, 150)) * timeoutEdge;
    shifts.GO += goBoost;

    if (goBoost > 0) {
      addDriver(drivers, 'A short conversion can materially reduce the opponent’s chance to regain possession.');
      tags.push('CONVERSION_CAN_SEAL');
    }
  }

  // 6) Regime-specific caps. The 2–5 minute window is deliberately conservative.
  let capPos = 0.30;
  let capNeg = -0.30;

  if (c.secondsRemaining <= 60) {
    capPos = 0.85;
    capNeg = -1.10;
  } else if (c.secondsRemaining <= 120) {
    capPos = 0.55;
    capNeg = -0.75;
  } else if (c.secondsRemaining <= 180) {
    capPos = 0.20;
    capNeg = -0.30;
  } else {
    capPos = 0.08;
    capNeg = -0.12;
  }

  for (const action of Object.keys(shifts)) {
    shifts[action] = clamp(shifts[action], capNeg, capPos);
  }

  const adjusted = {
    GO: shiftWp(options.GO, shifts.GO),
    FG: shiftWp(options.FG, shifts.FG),
    PUNT: shiftWp(options.PUNT, shifts.PUNT)
  };

  return {
    active: true,
    version: 'v0.5.1-gated-endgame',
    context: c,
    shifts,
    options: adjusted,
    drivers: drivers.slice(0, 4),
    tags: [...new Set(tags)]
  };
}
