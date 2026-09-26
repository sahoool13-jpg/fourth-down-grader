/**
 * 4TH DOWN v0.5 Endgame Intelligence
 *
 * A structural late-game layer applied to the primary GO / FG / PUNT model.
 * It does not hard-code nfl4th calls. Instead it encodes football constraints that
 * become dominant when possessions are scarce: whether three points can tie/lead,
 * whether giving the ball away can end the game, and whether a conversion preserves
 * a necessary touchdown path.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(clamp(Number(p), 0.001, 0.999) / (1 - clamp(Number(p), 0.001, 0.999)));
const shiftWp = (wp, shift) => wp == null ? null : clamp(sigmoid(logit(wp) + shift), 0.001, 0.999);

function urgency(seconds, window) {
  return clamp((window - Number(seconds)) / window, 0, 1);
}

function addDriver(drivers, text) {
  if (!drivers.includes(text)) drivers.push(text);
}

export function endgameContext(s, ctx = {}) {
  const sec = Number(s.secondsRemaining);
  const score = Number(s.scoreDiff);
  const deficit = Math.max(0, -score);
  const lead = Math.max(0, score);
  const pFg = ctx.pFg == null ? null : Number(ctx.pFg);
  const fgResultDiff = score + 3;
  return {
    active: sec <= 300,
    secondsRemaining: sec,
    scoreDiff: score,
    deficit,
    lead,
    fgResultDiff,
    fgAvailable: Boolean(ctx.fgAvailable),
    pFg,
    urgency5: urgency(sec, 300),
    urgency2: urgency(sec, 120),
    urgency60: urgency(sec, 60),
    offenseTimeouts: Number(s.timeouts),
    opponentTimeouts: Number(s.opponentTimeouts)
  };
}

/**
 * Returns endgame-adjusted raw option WPs.
 * Shifts are applied in log-odds space so no option is ever pushed outside [0, 1].
 * The layer is intentionally dormant outside the final five minutes.
 */
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

  const timeoutRelief = 0.58 + 0.14 * clamp(c.offenseTimeouts, 0, 3);

  // 1) Possession scarcity. Punting while behind becomes increasingly expensive
  // as the remaining clock can be consumed by the opponent.
  if (c.scoreDiff < 0) {
    const deficitFactor = 1 + 0.10 * Math.min(c.deficit, 8);
    let puntPenalty = (0.30 + 0.82 * c.urgency5 + 1.15 * c.urgency2) * deficitFactor * timeoutRelief;
    if (c.offenseTimeouts === 0) puntPenalty += 0.70 * c.urgency2;
    if (c.deficit >= 9) puntPenalty += 0.45 * c.urgency2;
    shifts.PUNT -= puntPenalty;
    if (c.urgency2 > 0.15) {
      addDriver(drivers, 'Endgame possession scarcity sharply reduces the value of giving the ball away while trailing.');
      tags.push('TRAILING_PUNT_SCARCITY');
    }
  }

  // 2) Must-touchdown logic. If a made FG still leaves the offense behind,
  // three points do not solve the terminal game state. GO preserves the TD path.
  if (c.scoreDiff < 0 && c.deficit >= 4) {
    shifts.GO += 0.18 * c.urgency5 + 0.52 * c.urgency2;
    if (c.fgAvailable && c.fgResultDiff < 0) {
      const residualDeficit = Math.abs(c.fgResultDiff);
      let fgPenalty = 0.28 + 0.82 * c.urgency5 + 1.28 * c.urgency2;
      fgPenalty *= 1 + 0.09 * Math.min(residualDeficit, 8);
      if (c.secondsRemaining <= 90) fgPenalty += 0.70 * c.urgency2;
      shifts.FG -= fgPenalty;
      addDriver(drivers, 'A field goal still leaves the team behind, so its terminal-game value is heavily discounted.');
      tags.push('FG_DOES_NOT_TIE_OR_LEAD');
    }
    if (c.urgency2 > 0.1) {
      addDriver(drivers, 'The offense still needs touchdown value, so retaining the conversion path matters more than ordinary field position.');
      tags.push('MUST_TD_PATH');
    }
  }

  // 3) A late FG that takes the lead has outsized value because the opponent has
  // very little time to answer. A tying FG gets a smaller boost because overtime / a
  // final opponent possession still exists.
  if (c.fgAvailable && c.pFg != null && c.scoreDiff >= -3 && c.scoreDiff <= 0) {
    if (c.fgResultDiff > 0) {
      const fgLeadBoost = (0.38 + 1.18 * c.urgency2 + 0.82 * c.urgency60) * (0.65 + 0.35 * c.pFg);
      shifts.FG += fgLeadBoost;
      // GO can still be correct, but it must beat the value of banking a lead now.
      shifts.GO -= (0.10 + 0.30 * c.urgency2) * c.pFg;
      addDriver(drivers, 'A made field goal takes the lead in the terminal window, so immediate score value rises sharply.');
      tags.push('FG_TAKES_LEAD');
    } else if (c.fgResultDiff === 0) {
      const fgTieBoost = (0.20 + 0.62 * c.urgency2 + 0.36 * c.urgency60) * (0.65 + 0.35 * c.pFg);
      shifts.FG += fgTieBoost;
      addDriver(drivers, 'A made field goal ties the game, preserving an overtime path that disappears on a failed fourth down.');
      tags.push('FG_TIES_GAME');
    }
  }

  // 4) Tied late is already covered by the go-ahead FG boost above. Keep a
  // separate audit tag, but do not double-count the same score-value effect.
  if (c.scoreDiff === 0 && c.fgAvailable && c.pFg != null) {
    addDriver(drivers, 'Late tie plus makeable field-goal range creates potential go-ahead or walk-off scoring value.');
    tags.push('TIED_FG_WINDOW');
  }

  // 5) Protect a late lead. A short conversion can terminate the opponent's chance
  // to get the ball back when timeout inventory is low.
  if (c.scoreDiff > 0 && c.secondsRemaining <= 150 && Number(s.ydstogo) <= 3) {
    const timeoutEdge = clamp((2 - c.opponentTimeouts) / 2, 0, 1);
    shifts.GO += (0.10 + 0.36 * urgency(c.secondsRemaining, 150)) * timeoutEdge;
    if (timeoutEdge > 0) {
      addDriver(drivers, 'A short conversion can end the game because the opponent has limited clock-stopping resources.');
      tags.push('CONVERSION_CAN_SEAL');
    }
  }

  // Keep the layer corrective rather than omnipotent. If a structural state needs a
  // shift larger than this, it belongs in the underlying WP model, not an endgame shim.
  for (const action of Object.keys(shifts)) shifts[action] = clamp(shifts[action], -4.0, 3.0);

  const adjusted = {
    GO: shiftWp(options.GO, shifts.GO),
    FG: shiftWp(options.FG, shifts.FG),
    PUNT: shiftWp(options.PUNT, shifts.PUNT)
  };

  return {
    active: true,
    context: c,
    shifts,
    options: adjusted,
    drivers: drivers.slice(0, 4),
    tags: [...new Set(tags)]
  };
}
