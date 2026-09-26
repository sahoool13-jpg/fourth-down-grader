const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=';

async function getJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'FourthDownGrader/0.2.3 (+personal analytics prototype)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!r.ok) throw new Error(`Upstream ${r.status}: ${url}`);
  return r.json();
}

export async function fetchScoreboard() {
  return getJson(SCOREBOARD);
}

export async function fetchSummary(eventId) {
  return getJson(`${SUMMARY}${encodeURIComponent(eventId)}`);
}

function competitorMap(header) {
  const comp = header?.competitions?.[0];
  const out = {};
  for (const c of comp?.competitors || []) {
    out[c.homeAway] = {
      id: String(c.id ?? c.team?.id ?? ''),
      abbreviation: c.team?.abbreviation,
      name: c.team?.displayName,
      color: c.team?.color,
      logo: c.team?.logo,
      score: Number(c.score ?? 0),
      homeAway: c.homeAway
    };
  }
  return out;
}

export function parseClockToSeconds(displayValue, quarter) {
  const [m, s] = String(displayValue || '0:00').split(':').map(Number);
  const qSeconds = (m || 0) * 60 + (s || 0);
  if (quarter <= 0) return 3600;
  if (quarter <= 4) return Math.max(0, (4 - quarter) * 900 + qSeconds);
  return qSeconds; // OT: period-clock only. Model flags are descriptive, not playoff-OT rules.
}

function isNoPlay(play) {
  const text = String(play?.text || '').toLowerCase();
  const type = String(play?.type?.text || '').toLowerCase();
  return text.includes('no play') ||
    type === 'penalty' ||
    text.startsWith('false start') ||
    text.startsWith('delay of game') ||
    text.startsWith('encroachment') ||
    text.startsWith('neutral zone infraction');
}

export function normalizeDecisionFromPlay(play) {
  if (isNoPlay(play)) return null;
  const type = String(play?.type?.text || play?.type?.abbreviation || '').toLowerCase();
  const text = String(play?.text || '').toLowerCase();

  // Fakes are strategic GO decisions even when the formation started as a kick.
  if (text.includes('fake punt') || text.includes('fake field goal') || type.includes('fake punt') || type.includes('fake field goal')) return 'GO';
  if (type.includes('punt') || /\bpunts?\b/.test(text)) return 'PUNT';
  if (type.includes('field goal') || text.includes('field goal')) return 'FG';
  if (
    type.includes('rush') || type.includes('run') || type.includes('pass') || type.includes('sack') ||
    text.includes(' pass ') || text.includes('scramble') || text.includes(' up the middle') ||
    text.includes(' left end') || text.includes(' right end') || text.includes(' left tackle') || text.includes(' right tackle')
  ) return 'GO';
  return null;
}

function playKey(play) {
  return String(play?.id || play?.sequenceNumber || `${play?.period?.number}-${play?.clock?.displayValue}-${play?.text}`);
}

function playSequence(play, fallback = 0) {
  const seq = Number(play?.sequenceNumber);
  if (Number.isFinite(seq)) return seq;
  const id = Number(play?.id);
  return Number.isFinite(id) ? id : fallback;
}

function flattenPlays(summary) {
  const plays = [];
  if (Array.isArray(summary?.plays)) plays.push(...summary.plays);
  const drives = summary?.drives;
  if (Array.isArray(drives?.previous)) {
    for (const d of drives.previous) if (Array.isArray(d.plays)) plays.push(...d.plays);
  }
  if (drives?.current?.plays) plays.push(...drives.current.plays);

  const seen = new Set();
  const unique = plays.filter(p => {
    const k = playKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique
    .map((p, i) => ({ p, i }))
    .sort((a, b) => playSequence(a.p, a.i) - playSequence(b.p, b.i))
    .map(x => x.p);
}

function extractTeamId(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const raw = String(value);
    if (/^\d+$/.test(raw)) return raw;
    return raw.match(/teams\/(\d+)/)?.[1] || raw.match(/~t:(\d+)/)?.[1] || '';
  }
  if (typeof value === 'object') {
    if (value.id != null) return String(value.id);
    const ref = String(value.$ref || value.ref || '');
    return ref.match(/teams\/(\d+)/)?.[1] || String(value.uid || '').match(/~t:(\d+)/)?.[1] || '';
  }
  return '';
}

function playTeamId(play) {
  // Pre-snap possession is authoritative. `play.team` can be play attribution.
  return extractTeamId(play?.start?.team) ||
    extractTeamId(play?.start?.possession) ||
    extractTeamId(play?.team);
}

function playPossessionSource(play) {
  if (extractTeamId(play?.start?.team)) return 'start.team';
  if (extractTeamId(play?.start?.possession)) return 'start.possession';
  if (extractTeamId(play?.team)) return 'play.team-fallback';
  return 'unknown';
}

function playDistance(play) {
  const direct = Number(play?.start?.distance);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const text = String(play?.start?.shortDownDistanceText || play?.start?.downDistanceText || '');
  const m = text.match(/(?:4th|4)\s*&\s*(Goal|\d+)/i);
  if (!m) return null;
  if (String(m[1]).toLowerCase() === 'goal') {
    const y = Number(play?.start?.yardsToEndzone ?? play?.start?.yardLine);
    return Number.isFinite(y) ? y : null;
  }
  return Number(m[1]);
}

function fieldPositionText(team, opp, yardline100) {
  if (!Number.isFinite(Number(yardline100))) return '';
  const y = Math.round(Number(yardline100));
  if (y === 50) return '50';
  return y > 50
    ? `${team?.abbreviation || 'OWN'} ${100 - y}`
    : `${opp?.abbreviation || 'OPP'} ${y}`;
}

function spotToYardline100(abbr, yard, offense, defense, { allowEndzone = false } = {}) {
  if (!offense || !defense) return null;
  const teamAbbr = String(abbr || '').toUpperCase();
  const n = Number(yard);
  if (!Number.isFinite(n)) return null;
  if (!allowEndzone && (n < 0 || n > 50)) return null;
  if (allowEndzone && (n < -10 || n > 50)) return null;
  if (teamAbbr === String(offense.abbreviation || '').toUpperCase()) return 100 - n;
  if (teamAbbr === String(defense.abbreviation || '').toUpperCase()) return n;
  return null;
}

function spotFromText(text, offense, defense) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // ESPN commonly provides e.g. "4th & 9 at GB 12" or possessionText "GB 12".
  // This is the safest source because it identifies BOTH the side of midfield and yard number.
  const matches = [...raw.matchAll(/(?:\bat\s+)?\b([A-Z]{2,3})\s+(-?\d{1,2})\b/gi)];
  for (const m of matches) {
    const y100 = spotToYardline100(m[1], Number(m[2]), offense, defense);
    if (Number.isFinite(y100) && y100 >= 1 && y100 <= 99) {
      return { yardline100: y100, fieldPositionText: `${m[1].toUpperCase()} ${Number(m[2])}`, source: 'espn-text' };
    }
  }

  if (/\b(?:at\s+)?50\b/i.test(raw)) {
    return { yardline100: 50, fieldPositionText: '50', source: 'espn-text' };
  }
  return null;
}

function puntInference(play, offense, defense) {
  const text = String(play?.text || '');
  // Examples: "punts 52 yards to ATL 36" and "punts 64 yards to ATL -1".
  const m = text.match(/\bpunts?\s+(\d{1,2})\s+yards?\s+to\s+([A-Z]{2,3})\s+(-?\d{1,2})\b/i);
  if (!m) return null;
  const kickDistance = Number(m[1]);
  const destinationY100 = spotToYardline100(m[2], Number(m[3]), offense, defense, { allowEndzone: true });
  if (!Number.isFinite(destinationY100)) return null;
  const inferredStart = destinationY100 + kickDistance;
  if (inferredStart < 1 || inferredStart > 99) return null;
  return {
    yardline100: inferredStart,
    source: 'punt-geometry',
    kickDistance,
    destinationYardline100: destinationY100
  };
}

function fieldGoalInference(play) {
  const text = String(play?.text || '');
  const m = text.match(/\b(\d{2})[- ](?:yard|yd)\s+field\s+goal\b/i);
  if (!m) return null;
  const kickDistance = Number(m[1]);
  // NFL holder is roughly seven yards behind LOS + ten-yard end zone.
  const inferredStart = kickDistance - 17;
  if (inferredStart < 1 || inferredStart > 58) return null;
  return { yardline100: inferredStart, source: 'field-goal-distance', kickDistance };
}

function numericY100Candidates(play) {
  // These ESPN fields are NOT trusted for field side by themselves. Different endpoint
  // versions have represented them as either yard number or distance-to-goal. They are
  // retained only as low-priority corroboration / conflict diagnostics.
  const vals = [];
  for (const [source, value] of [
    ['start.yardsToEndzone', play?.start?.yardsToEndzone],
    ['start.yardline100', play?.start?.yardline100]
  ]) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1 && n <= 99) vals.push({ yardline100: n, source });
  }
  return vals;
}

function resolvePlayFieldPosition(play, offense, defense) {
  const textCandidates = [
    ['start.downDistanceText', play?.start?.downDistanceText],
    ['start.shortDownDistanceText', play?.start?.shortDownDistanceText],
    ['start.possessionText', play?.start?.possessionText]
  ].map(([source, text]) => {
    const parsed = spotFromText(text, offense, defense);
    return parsed ? { ...parsed, source } : null;
  }).filter(Boolean);

  // Multiple explicit pre-snap text fields should agree. If they don't, do not grade.
  const textValues = [...new Set(textCandidates.map(x => Math.round(x.yardline100)))];
  if (textValues.length > 1) {
    return {
      yardline100: null,
      fieldPositionText: '',
      source: 'conflict',
      verified: false,
      conflict: `pre-snap text disagrees: ${textValues.join(' vs ')}`,
      candidates: textCandidates
    };
  }

  const textSpot = textCandidates[0] || null;
  const puntSpot = normalizeDecisionFromPlay(play) === 'PUNT' ? puntInference(play, offense, defense) : null;
  const fgSpot = normalizeDecisionFromPlay(play) === 'FG' ? fieldGoalInference(play) : null;
  const geometry = puntSpot || fgSpot;
  const numeric = numericY100Candidates(play);

  let chosen = textSpot || geometry || numeric[0] || null;
  if (!chosen) {
    return { yardline100: null, fieldPositionText: '', source: 'unknown', verified: false, conflict: null, candidates: [] };
  }

  // Kick geometry is a powerful integrity check. ESPN's displayed 4th-down spot can
  // occasionally keep the yard number but flip the team abbreviation. For a punt,
  // kick distance + landing spot determines the LOS exactly. For a field goal, kick
  // distance constrains the LOS to roughly distance-17. In those cases geometry wins.
  let sourceConflict = null;
  if (textSpot && geometry && Math.abs(textSpot.yardline100 - geometry.yardline100) > 2) {
    sourceConflict = `ESPN text ${textSpot.fieldPositionText || textSpot.yardline100} contradicted by ${geometry.source} (${geometry.yardline100})`;
    chosen = geometry;
  }

  const strong = Boolean(textSpot || geometry);
  const numericConflicts = numeric.filter(n => Math.abs(n.yardline100 - chosen.yardline100) > 3);
  const fieldPositionTextValue = fieldPositionText(offense, defense, chosen.yardline100);

  return {
    yardline100: chosen.yardline100,
    fieldPositionText: fieldPositionTextValue,
    source: sourceConflict ? `${geometry.source}-override` : textSpot ? textSpot.source : geometry ? geometry.source : chosen.source,
    verified: strong,
    conflict: null,
    sourceConflict,
    numericConflict: numericConflicts.length ? numericConflicts.map(x => `${x.source}=${x.yardline100}`).join(', ') : null,
    candidates: [textSpot, geometry, ...numeric].filter(Boolean)
  };
}

function resolveCurrentFieldPosition(situation, offense, defense) {
  for (const [source, text] of [
    ['situation.downDistanceText', situation?.downDistanceText],
    ['situation.possessionText', situation?.possessionText]
  ]) {
    const parsed = spotFromText(text, offense, defense);
    if (parsed) return { ...parsed, source, verified: true };
  }

  // Current-state feeds sometimes expose a true yards-to-endzone value. Use it only as
  // fallback, and label it unverified because it lacks field-side identity.
  const direct = Number(situation?.yardsToEndzone ?? situation?.yardline100);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 99) {
    return {
      yardline100: direct,
      fieldPositionText: fieldPositionText(offense, defense, direct),
      source: 'current-numeric-fallback',
      verified: false
    };
  }
  return { yardline100: null, fieldPositionText: '', source: 'unknown', verified: false };
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function timeoutTeamId(play, teams) {
  const type = String(play?.type?.text || '').toLowerCase();
  const text = String(play?.text || '');
  if (!type.includes('timeout') && !/\btimeout\b/i.test(text)) return '';

  const direct = extractTeamId(play?.team);
  if (direct === teams.home?.id || direct === teams.away?.id) return direct;

  for (const t of [teams.home, teams.away]) {
    if (!t) continue;
    const abbr = String(t.abbreviation || '');
    const name = String(t.name || '');
    if ((abbr && new RegExp(`\\b${abbr}\\b`, 'i').test(text)) ||
        (name && text.toLowerCase().includes(name.toLowerCase()))) return t.id;
  }
  return '';
}

function probabilityTimeline(summary) {
  const arr = Array.isArray(summary?.winprobability) ? summary.winprobability : [];
  return arr.map((w, idx) => {
    const ref = String(w?.play?.$ref || '');
    const refId = ref.match(/plays\/([^/?]+)/)?.[1];
    const seqRaw = Number(w?.sequenceNumber);
    return {
      index: idx,
      sequence: Number.isFinite(seqRaw) ? seqRaw : idx,
      playId: String(w?.playId ?? w?.play?.id ?? refId ?? ''),
      homeWp: Number(w?.homeWinPercentage),
      awayWp: Number.isFinite(Number(w?.awayWinPercentage)) ? Number(w.awayWinPercentage) : 1 - Number(w?.homeWinPercentage)
    };
  }).filter(x => Number.isFinite(x.homeWp))
    .sort((a, b) => a.sequence - b.sequence || a.index - b.index);
}

function offenseWp(homeWp, offense, teams) {
  if (!Number.isFinite(homeWp) || !offense) return null;
  return offense.id === teams.home?.id ? homeWp : 1 - homeWp;
}

function prePlayWpFor(playId, offense, teams, timeline) {
  if (!timeline.length) return null;
  const idx = timeline.findIndex(x => x.playId && String(x.playId) === String(playId));
  if (idx > 0) return offenseWp(timeline[idx - 1].homeWp, offense, teams);
  if (idx === 0) return offenseWp(timeline[0].homeWp, offense, teams);
  return null;
}

function currentWpFor(offense, teams, timeline) {
  if (!timeline.length || !offense) return null;
  return offenseWp(timeline.at(-1).homeWp, offense, teams);
}

function situationYardline100(situation, offense, defense) {
  return resolveCurrentFieldPosition(situation, offense, defense);
}

function timeoutsFor(situation, offense, defense, teams) {
  const home = Number(situation?.homeTimeouts ?? situation?.timeouts?.[teams.home?.id] ?? 3);
  const away = Number(situation?.awayTimeouts ?? situation?.timeouts?.[teams.away?.id] ?? 3);
  const offenseTo = offense?.id === teams.home?.id ? home : away;
  const defenseTo = defense?.id === teams.home?.id ? home : away;
  return {
    timeouts: Number.isFinite(offenseTo) ? offenseTo : 3,
    opponentTimeouts: Number.isFinite(defenseTo) ? defenseTo : 3
  };
}

export function parseGameSummary(summary) {
  const header = summary?.header;
  const teams = competitorMap(header);
  const comp = header?.competitions?.[0] || {};
  const situation = comp.situation || summary?.situation || {};
  const status = comp.status || {};
  const timeline = probabilityTimeline(summary);

  const possessionId = extractTeamId(situation?.possession) || extractTeamId(situation?.team);
  const offense = possessionId === teams.home?.id ? teams.home : possessionId === teams.away?.id ? teams.away : null;
  const defense = offense?.id === teams.home?.id ? teams.away : offense?.id === teams.away?.id ? teams.home : null;

  const quarter = Number(status?.period ?? 0);
  const clock = status?.displayClock || status?.type?.shortDetail?.match(/\d+:\d+/)?.[0] || '0:00';
  const secondsRemaining = parseClockToSeconds(clock, quarter);
  const down = Number(situation?.down ?? 0);
  const currentField = situationYardline100(situation, offense, defense);
  const yardline100 = currentField.yardline100;
  const goalToGo = /&\s*Goal/i.test(String(situation?.downDistanceText || ''));
  const parsedDistance = situation?.distance ?? situation?.downDistanceText?.match(/&\s*(\d+)/)?.[1];
  const ydstogo = goalToGo && Number.isFinite(Number(yardline100)) ? Number(yardline100) : Number(parsedDistance ?? 0);
  const scoreDiff = offense && defense ? offense.score - defense.score : 0;
  const tos = timeoutsFor(situation, offense, defense, teams);
  const currentWp = currentWpFor(offense, teams, timeline);
  const currentFieldPositionText = currentField.fieldPositionText;
  const currentScoreText = offense && defense ? `${offense.abbreviation} ${offense.score}–${defense.score} ${defense.abbreviation}` : '';

  const completed = [];
  const allPlays = flattenPlays(summary);
  let lastHomeScore = 0;
  let lastAwayScore = 0;
  let homeTimeouts = 3;
  let awayTimeouts = 3;
  let half = 1;

  for (const p of allPlays) {
    const q = Number(p?.period?.number || p?.period || 0);
    if (q >= 3 && half === 1) {
      half = 2;
      homeTimeouts = 3;
      awayTimeouts = 3;
    }

    const explicitStartHomeScore = finiteNumber(p?.start?.homeScore);
    const explicitStartAwayScore = finiteNumber(p?.start?.awayScore);
    const preHomeScore = explicitStartHomeScore ?? lastHomeScore;
    const preAwayScore = explicitStartAwayScore ?? lastAwayScore;

    const explicitHomeTimeouts = finiteNumber(p?.start?.homeTimeouts, p?.homeTimeoutsRemaining);
    const explicitAwayTimeouts = finiteNumber(p?.start?.awayTimeouts, p?.awayTimeoutsRemaining);
    const preHomeTimeouts = explicitHomeTimeouts ?? homeTimeouts;
    const preAwayTimeouts = explicitAwayTimeouts ?? awayTimeouts;

    if (Number(p?.start?.down) === 4) {
      const decision = normalizeDecisionFromPlay(p);
      if (decision) {
        const teamId = playTeamId(p);
        const team = teamId === teams.home?.id ? teams.home : teamId === teams.away?.id ? teams.away : null;
        if (team) {
          const opp = team.id === teams.home?.id ? teams.away : teams.home;
          const clockText = String(p?.clock?.displayValue || p?.clock || '');
          const pr = parseClockToSeconds(clockText, q);
          const field = resolvePlayFieldPosition(p, team, opp);
          const y100 = field.yardline100;
          let distance = playDistance(p);
          if (/&\s*Goal/i.test(String(p?.start?.downDistanceText || p?.start?.shortDownDistanceText || '')) && Number.isFinite(Number(y100))) {
            distance = Number(y100);
          }
          const playId = playKey(p);
          const baselineWp = prePlayWpFor(playId, team, teams, timeline);
          const derivedFieldPosition = field.fieldPositionText;
          const rawFieldPositionText = String(p?.start?.possessionText || '').trim();
          const offenseScore = team.id === teams.home?.id ? preHomeScore : preAwayScore;
          const defenseScore = team.id === teams.home?.id ? preAwayScore : preHomeScore;
          const offenseTimeouts = team.id === teams.home?.id ? preHomeTimeouts : preAwayTimeouts;
          const defenseTimeouts = team.id === teams.home?.id ? preAwayTimeouts : preHomeTimeouts;
          const possessionSource = playPossessionSource(p);
          const possessionVerified = Boolean(teamId && (possessionSource === 'start.team' || possessionSource === 'start.possession'));
          const scoreVerified = Number.isFinite(offenseScore) && Number.isFinite(defenseScore);
          const verifiedState = Number.isFinite(q) && q > 0 && Boolean(clockText) && possessionVerified && scoreVerified &&
            field.verified && !field.conflict &&
            Number.isFinite(Number(distance)) && Number(distance) >= 0 &&
            Number.isFinite(Number(y100)) && Number(y100) > 0;

          completed.push({
            id: playId,
            text: p.text,
            rawSituationText: p?.start?.downDistanceText || p?.start?.shortDownDistanceText || '',
            rawFieldPositionText,
            fieldPositionText: derivedFieldPosition,
            fieldPositionSource: field.source,
            fieldPositionVerified: field.verified,
            fieldPositionConflict: field.conflict,
            fieldPositionSourceConflict: field.sourceConflict || null,
            numericFieldConflict: field.numericConflict || null,
            situationText: `${p?.start?.shortDownDistanceText || `4th & ${distance ?? '?'}`} ${derivedFieldPosition ? `at ${derivedFieldPosition}` : ''}`.trim(),
            actualDecision: decision,
            offense: team,
            defense: opp,
            possessionTeamId: team.id,
            possessionSource,
            possessionVerified,
            quarter: q,
            clock: clockText,
            secondsRemaining: pr,
            ydstogo: Number(distance),
            yardline100: y100,
            homeScoreBefore: preHomeScore,
            awayScoreBefore: preAwayScore,
            offenseScore,
            defenseScore,
            scoreDiff: offenseScore - defenseScore,
            scoreText: `${team.abbreviation} ${offenseScore}–${defenseScore} ${opp.abbreviation}`,
            timeouts: offenseTimeouts,
            opponentTimeouts: defenseTimeouts,
            timeoutSource: explicitHomeTimeouts != null || explicitAwayTimeouts != null ? 'espn-explicit' : 'play-by-play-reconstruction',
            baselineWp,
            indoor: Boolean(comp?.venue?.indoor),
            verifiedState,
            stateQuality: verifiedState ? (baselineWp != null ? 'VERIFIED' : 'STRUCTURAL') : 'REVIEW',
            reviewRequired: !verifiedState
          });
        }
      }
    }

    // Freeze first, then update post-play state. ESPN's play-level scores are post-play.
    const postHome = finiteNumber(p?.end?.homeScore, p?.homeScore);
    const postAway = finiteNumber(p?.end?.awayScore, p?.awayScore);
    if (postHome != null) lastHomeScore = postHome;
    if (postAway != null) lastAwayScore = postAway;

    if (explicitHomeTimeouts != null) homeTimeouts = explicitHomeTimeouts;
    if (explicitAwayTimeouts != null) awayTimeouts = explicitAwayTimeouts;
    const timeoutId = timeoutTeamId(p, teams);
    if (timeoutId === teams.home?.id) homeTimeouts = Math.max(0, homeTimeouts - 1);
    if (timeoutId === teams.away?.id) awayTimeouts = Math.max(0, awayTimeouts - 1);
  }

  const baseSituation = offense ? {
    offense,
    defense,
    quarter,
    clock,
    secondsRemaining,
    ydstogo,
    yardline100,
    scoreDiff,
    scoreText: currentScoreText,
    fieldPositionText: currentFieldPositionText,
    fieldPositionSource: currentField.source,
    fieldPositionVerified: currentField.verified,
    ...tos,
    indoor: Boolean(comp?.venue?.indoor),
    baselineWp: currentWp
  } : null;

  return {
    eventId: String(header?.id || comp.id || ''),
    name: header?.shortName || header?.name,
    venue: comp?.venue?.fullName,
    indoor: Boolean(comp?.venue?.indoor),
    teams,
    state: status?.type?.state || '',
    status: status?.type?.shortDetail || status?.type?.description || status?.type?.name || '',
    currentWinProbability: currentWp,
    pendingFourthDown: down === 4 && baseSituation?.yardline100 ? baseSituation : null,
    pendingThirdDown: down === 3 && baseSituation?.yardline100 ? baseSituation : null,
    completedFourthDowns: completed
  };
}

export function parseScoreboard(raw) {
  return (raw?.events || []).map(event => {
    const comp = event.competitions?.[0] || {};
    const cs = comp.competitors || [];
    const home = cs.find(c => c.homeAway === 'home');
    const away = cs.find(c => c.homeAway === 'away');
    return {
      id: String(event.id),
      name: event.shortName || event.name,
      date: event.date,
      state: comp.status?.type?.state,
      status: comp.status?.type?.shortDetail || comp.status?.type?.description,
      home: { id: String(home?.id || home?.team?.id || ''), abbreviation: home?.team?.abbreviation, score: home?.score, color: home?.team?.color },
      away: { id: String(away?.id || away?.team?.id || ''), abbreviation: away?.team?.abbreviation, score: away?.score, color: away?.team?.color }
    };
  });
}
