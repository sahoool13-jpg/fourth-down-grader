const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=';

async function getJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'FourthDownGrader/0.2 (+personal analytics prototype)',
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

function flattenPlays(summary) {
  const plays = [];
  if (Array.isArray(summary?.plays)) plays.push(...summary.plays);
  const drives = summary?.drives;
  if (Array.isArray(drives?.previous)) {
    for (const d of drives.previous) if (Array.isArray(d.plays)) plays.push(...d.plays);
  }
  if (drives?.current?.plays) plays.push(...drives.current.plays);
  const seen = new Set();
  return plays.filter(p => {
    const k = String(p.id || p.sequenceNumber || `${p?.period?.number}-${p?.clock?.displayValue}-${p.text}`);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function playTeamId(play) {
  return String(play?.team?.id || play?.start?.team?.id || play?.start?.possession || '');
}

function playDistance(play) {
  const direct = Number(play?.start?.distance);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const text = String(play?.start?.shortDownDistanceText || play?.start?.downDistanceText || '');
  const m = text.match(/(?:4th|4)\s*&\s*(Goal|\d+)/i);
  if (!m) return null;
  if (String(m[1]).toLowerCase() === 'goal') {
    const y = Number(play?.start?.yardsToEndzone);
    return Number.isFinite(y) ? y : null;
  }
  return Number(m[1]);
}

function fieldPositionTextFromPlay(play, team, opp, yardline100) {
  const direct = String(play?.start?.possessionText || '').trim();
  if (direct) return direct;
  if (!Number.isFinite(Number(yardline100))) return '';
  const y = Math.round(Number(yardline100));
  if (y === 50) return '50';
  return y < 50 ? `${opp?.abbreviation || 'OPP'} ${y}` : `${team?.abbreviation || 'OWN'} ${100 - y}`;
}

function yardline100FromPlay(play, possessionTeamId, teams) {
  const direct = Number(play?.start?.yardsToEndzone ?? play?.start?.yardline100);
  if (Number.isFinite(direct) && direct > 0) return Math.max(1, Math.min(99, direct));

  // possessionText like "MIA 37" means the ball is at that team's own 37.
  const possessionText = String(play?.start?.possessionText || '');
  const m = possessionText.match(/^([A-Z]{2,3})\s+(\d{1,2})$/);
  if (m) {
    const abbr = m[1];
    const yard = Number(m[2]);
    const offense = String(possessionTeamId) === teams.home?.id ? teams.home : String(possessionTeamId) === teams.away?.id ? teams.away : null;
    if (offense?.abbreviation === abbr) return 100 - yard;
    return yard;
  }

  const yardLine = Number(play?.start?.yardLine);
  if (!Number.isFinite(yardLine)) return null;
  if (possessionTeamId && teams.home?.id && String(possessionTeamId) === teams.home.id) return Math.max(1, 100 - yardLine);
  if (possessionTeamId && teams.away?.id && String(possessionTeamId) === teams.away.id) return Math.max(1, yardLine);
  return null;
}

function scoreDiffAtPlay(play, team, opp, teams) {
  const hs = Number(play?.start?.homeScore ?? play?.homeScore);
  const as = Number(play?.start?.awayScore ?? play?.awayScore);
  const homeScore = Number.isFinite(hs) ? hs : Number(teams.home?.score || 0);
  const awayScore = Number.isFinite(as) ? as : Number(teams.away?.score || 0);
  if (!team || !opp) return 0;
  return team.id === teams.home?.id ? homeScore - awayScore : awayScore - homeScore;
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

function situationYardline100(situation, offense, teams) {
  const direct = Number(situation?.yardsToEndzone ?? situation?.yardline100);
  if (Number.isFinite(direct) && direct > 0) return Math.max(1, Math.min(99, direct));

  const text = String(situation?.possessionText || situation?.downDistanceText || '');
  const m = text.match(/(?:at\s+)?([A-Z]{2,3})\s+(\d{1,2})/i);
  if (m) {
    const abbr = m[1].toUpperCase();
    const yard = Number(m[2]);
    return offense?.abbreviation === abbr ? 100 - yard : yard;
  }

  const abs = Number(situation?.yardLine);
  if (!Number.isFinite(abs)) return null;
  if (offense?.id === teams.home?.id) return Math.max(1, 100 - abs);
  if (offense?.id === teams.away?.id) return Math.max(1, abs);
  return null;
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

  const possessionId = String(situation?.possession?.id ?? situation?.possession ?? '');
  const offense = possessionId === teams.home?.id ? teams.home : possessionId === teams.away?.id ? teams.away : null;
  const defense = offense?.id === teams.home?.id ? teams.away : offense?.id === teams.away?.id ? teams.home : null;

  const quarter = Number(status?.period ?? 0);
  const clock = status?.displayClock || status?.type?.shortDetail?.match(/\d+:\d+/)?.[0] || '0:00';
  const secondsRemaining = parseClockToSeconds(clock, quarter);
  const down = Number(situation?.down ?? 0);
  const ydstogo = Number(situation?.distance ?? situation?.downDistanceText?.match(/&\s*(\d+)/)?.[1] ?? 0);
  const yardline100 = situationYardline100(situation, offense, teams);
  const scoreDiff = offense && defense ? offense.score - defense.score : 0;
  const tos = timeoutsFor(situation, offense, defense, teams);
  const currentWp = currentWpFor(offense, teams, timeline);

  const completed = [];
  for (const p of flattenPlays(summary)) {
    if (Number(p?.start?.down) !== 4) continue;
    const decision = normalizeDecisionFromPlay(p);
    if (!decision) continue;

    const teamId = playTeamId(p);
    const team = teamId === teams.home?.id ? teams.home : teamId === teams.away?.id ? teams.away : null;
    if (!team) continue;
    const opp = team.id === teams.home?.id ? teams.away : teams.home;
    const q = Number(p?.period?.number || p?.period || 0);
    const clockText = String(p?.clock?.displayValue || p?.clock || '');
    const pr = parseClockToSeconds(clockText, q);
    const y100 = yardline100FromPlay(p, teamId, teams);
    const distance = playDistance(p);
    const playId = String(p.id || p.sequenceNumber || `${q}-${clockText}-${p.text}`);
    const baselineWp = prePlayWpFor(playId, team, teams, timeline);
    const fieldPositionText = fieldPositionTextFromPlay(p, team, opp, y100);
    const verifiedState = Number.isFinite(q) && q > 0 && Boolean(clockText) &&
      Number.isFinite(Number(distance)) && Number(distance) >= 0 &&
      Number.isFinite(Number(y100)) && Number(y100) > 0;

    completed.push({
      id: playId,
      text: p.text,
      rawSituationText: p?.start?.downDistanceText || p?.start?.shortDownDistanceText || '',
      fieldPositionText,
      situationText: `${p?.start?.shortDownDistanceText || `4th & ${distance ?? '?'}`} ${fieldPositionText ? `at ${fieldPositionText}` : ''}`.trim(),
      actualDecision: decision,
      offense: team,
      defense: opp,
      quarter: q,
      clock: clockText,
      secondsRemaining: pr,
      ydstogo: Number(distance),
      yardline100: y100,
      scoreDiff: scoreDiffAtPlay(p, team, opp, teams),
      baselineWp,
      indoor: Boolean(comp?.venue?.indoor),
      verifiedState,
      reviewRequired: !verifiedState
    });
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
