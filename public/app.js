const $ = (s) => document.querySelector(s);
const fmtWp = (x) => x == null ? '—' : `${(x * 100).toFixed(1)}%`;
const fmtBurn = (x) => x == null ? '—' : x < .0005 ? '0.0' : `-${(x * 100).toFixed(1)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let selectedGameId = null;
let selectedGameName = null;
let lastLiveData = null;
let liveTimer = null;
let selectedTimer = null;
const benchmarkCache = new Map();
let selectedBenchmark = null;

function badgeClass(certainty) {
  return certainty === 'CLEAR' ? 'clear' : certainty === 'LEAN' ? 'lean' : 'neutral';
}

function renderEvaluation(ev) {
  if (!ev?.options) return;
  const entries = Object.entries(ev.options).sort((a, b) => b[1] - a[1]);
  $('#decisionTitle').textContent = 'Primary optimal call';
  const badge = $('#certaintyBadge');
  badge.textContent = `${ev.certainty} • ${ev.sensitivity?.confidence || '—'} STABILITY`;
  badge.className = `badge ${badgeClass(ev.certainty)}`;

  const max = Math.max(...entries.map(x => x[1]));
  const min = Math.min(...entries.map(x => x[1]));
  const range = Math.max(.02, max - min);

  $('#decisionOutput').innerHTML = `
    <div class="rec">
      <div class="recCall">
        <small>RECOMMENDATION</small>
        <strong>${ev.certainty === 'TOSS-UP' ? 'TOSS-UP' : esc(ev.optimal)}</strong>
        <div class="muted">${ev.certainty === 'TOSS-UP' ? `Slight lean: ${esc(ev.optimal)} • ` : ''}+${(ev.edge * 100).toFixed(1)} WP vs next-best</div>
        <div class="anchorPill">${ev.diagnostics?.liveAnchorUsed ? 'LIVE WP ANCHORED' : 'STRUCTURAL MODE'}</div>
      </div>
      <div>
        <div class="bars">${entries.map(([d, wp]) => {
          const width = 25 + 75 * ((wp - min) / range);
          const r = ev.sensitivity?.optionRanges?.[d];
          return `<div class="barrow ${d === ev.optimal ? 'best' : ''}">
            <span>${d}</span><div class="track"><div class="fill" style="width:${width}%"></div></div><b>${fmtWp(wp)}</b>
            <small>${r ? `${fmtWp(r.low)}–${fmtWp(r.high)}` : ''}</small>
          </div>`;
        }).join('')}</div>
        <div class="diag">
          <span>Baseline: ${fmtWp(ev.baselineWp)}</span>
          <span>Convert: ${fmtWp(ev.diagnostics?.firstDownProbability)}</span>
          <span>${ev.diagnostics?.kickDistance ? `FG ${ev.diagnostics.kickDistance.toFixed(0)} yd: ${fmtWp(ev.diagnostics.fgMakeProbability)}` : 'FG unavailable'}</span>
          <span>Punt leaves opp y100 ≈ ${ev.diagnostics?.expectedOpponentYardlineAfterPunt?.toFixed?.(0) ?? '—'}</span>
          <span>Robustness: ${Math.round((ev.sensitivity?.robustness || 0) * 100)}%</span>
        </div>
        <div class="drivers">${(ev.drivers || []).map(d => `<div><i></i><span>${esc(d)}</span></div>`).join('')}</div>
      </div>
    </div>`;
}

function manualPayload() {
  return Object.fromEntries(['ydstogo','yardline100','scoreDiff','secondsRemaining','timeouts','opponentTimeouts'].map(id => [id, Number($('#' + id).value)]));
}

async function evaluateManual(e) {
  e?.preventDefault();
  $('#thirdDownOutput').classList.add('hidden');
  const r = await fetch('/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manualPayload()) });
  renderEvaluation(await r.json());
}

async function evaluateThirdDown() {
  const r = await fetch('/api/evaluate-third', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manualPayload()) });
  const plan = await r.json();
  const box = $('#thirdDownOutput');
  box.classList.remove('hidden');
  box.innerHTML = `<span class="kicker">3RD-DOWN PLANNING</span><strong>${plan.twoDownTerritory ? 'TWO-DOWN TERRITORY' : 'ONE-DOWN PRESSURE'}</strong><p>${esc(plan.message)}</p>`;
}

function renderGames(games = []) {
  if (!games.length) {
    $('#games').innerHTML = '<div class="empty">No NFL games returned by the feed.</div>';
    return;
  }
  $('#games').innerHTML = games.map(g => `
    <div class="game ${g.id === selectedGameId ? 'active' : ''}" data-id="${esc(g.id)}" data-name="${esc(g.name)}">
      <div>
        <div class="teams">
          <div class="teamrow"><span>${esc(g.away.abbreviation || 'AWAY')}</span><b>${esc(g.away.score ?? '')}</b></div>
          <div class="teamrow"><span>${esc(g.home.abbreviation || 'HOME')}</span><b>${esc(g.home.score ?? '')}</b></div>
        </div>
        <div class="gameMeta">${esc(g.status || new Date(g.date).toLocaleString())}</div>
      </div>
      <span class="state ${String(g.state).toLowerCase() === 'in' ? 'in' : ''}">${esc(String(g.state || 'PRE').toUpperCase())}</span>
    </div>`).join('');
  document.querySelectorAll('.game').forEach(el => el.addEventListener('click', () => selectGame(el.dataset.id, el.dataset.name)));
}

function renderAlerts(data) {
  const strip = $('#alertStrip');
  const alerts = [];
  for (const p of data.pendingFourthDowns || []) {
    alerts.push(`<button class="alertCard fourth" data-id="${esc(p.eventId)}"><span>LIVE 4TH DOWN</span><strong>${esc(p.offense?.abbreviation)} • 4th & ${esc(p.ydstogo)} • ${esc(p.clock)} Q${esc(p.quarter)}</strong><b>${esc(p.evaluation?.optimal)} ${fmtWp(p.evaluation?.options?.[p.evaluation?.optimal])}</b></button>`);
  }
  for (const p of data.twoDownAlerts || []) {
    alerts.push(`<button class="alertCard third" data-id="${esc(p.eventId)}"><span>TWO-DOWN ALERT</span><strong>${esc(p.offense?.abbreviation)} • 3rd & ${esc(p.ydstogo)} • ${esc(p.clock)} Q${esc(p.quarter)}</strong><b>${esc(p.planning?.message)}</b></button>`);
  }
  if (!alerts.length) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }
  strip.classList.remove('hidden');
  strip.innerHTML = alerts.join('');
  strip.querySelectorAll('.alertCard').forEach(el => el.addEventListener('click', () => selectGame(el.dataset.id, 'Live game')));
}


function benchmarkOptionsText(b) {
  if (!b) return '';
  const vals = [['GO', b.go_wp], ['FG', b.fg_wp], ['PUNT', b.punt_wp]]
    .filter(([,v]) => Number.isFinite(Number(v)))
    .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`);
  return vals.join(' • ');
}

function benchmarkByPlay(benchmark) {
  return new Map((benchmark?.rows || []).map(r => [String(r.play_id), r]));
}

function benchmarkRelation(row, b) {
  if (!b?.optimal || !row?.optimal) return { kind: 'PRIMARY_ONLY', label: 'PRIMARY ONLY', split: false };
  const a = String(row.optimal).toUpperCase();
  const ref = String(b.optimal).toUpperCase();
  if (a === ref) return { kind: 'CONSENSUS', label: 'CONSENSUS WITH NFL4TH', split: false };
  const primaryFragile = row.certainty === 'TOSS-UP';
  const benchmarkFragile = b.certainty === 'TOSS-UP' || Number(b.edge_pp) < 0.75;
  if (primaryFragile || benchmarkFragile) {
    return { kind: 'SOFT_SPLIT', label: 'MODEL DIFFERENCE • LOW MARGIN', split: false };
  }
  return { kind: 'MODEL_SPLIT', label: 'MODEL SPLIT • REVIEW', split: true };
}

function renderBenchmarkStatus(rows = [], benchmark = null) {
  const el = $('#benchmarkStatus');
  if (!el) return;
  if (!benchmark?.rows?.length) {
    el.textContent = selectedGameId ? 'NFL4TH BENCHMARK: pending / unavailable' : 'NFL4TH BENCHMARK: select a game';
    el.className = 'benchmarkStatus muted';
    return;
  }
  const byId = benchmarkByPlay(benchmark);
  let matched = 0, eligible = 0, agree = 0, strongSplits = 0;
  for (const row of rows) {
    const b = byId.get(String(row.id));
    if (!b) continue;
    matched++;
    if (!row.optimal || !b.optimal) continue;
    eligible++;
    const rel = benchmarkRelation(row, b);
    if (String(row.optimal).toUpperCase() === String(b.optimal).toUpperCase()) agree++;
    if (rel.split) strongSplits++;
  }
  const pct = eligible ? Math.round(100 * agree / eligible) : 0;
  el.textContent = `NFL4TH BENCHMARK: ${matched}/${rows.length} matched • ${pct}% exact-call agreement${strongSplits ? ` • ${strongSplits} strong split${strongSplits === 1 ? '' : 's'}` : ''}`;
  el.className = `benchmarkStatus ${strongSplits ? 'hasSplit' : 'hasConsensus'}`;
}

async function getBenchmark(eventId) {
  const id = String(eventId || '');
  const hit = benchmarkCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  try {
    const r = await fetch(`/api/benchmark/${encodeURIComponent(id)}`);
    if (!r.ok) {
      benchmarkCache.set(id, { at: Date.now(), data: null });
      return null;
    }
    const payload = await r.json();
    const data = payload?.benchmark || null;
    benchmarkCache.set(id, { at: Date.now(), data });
    return data;
  } catch {
    benchmarkCache.set(id, { at: Date.now(), data: null });
    return null;
  }
}

function renderLedger(rows = [], title = 'Live fourth-down ledger', benchmark = null) {
  $('#ledgerTitle').textContent = title;
  const tbody = $('#decisionFeed tbody');
  const benchForCount = benchmarkByPlay(benchmark);
  const effectiveGraded = rows.filter(r => {
    if (!r.grade || ['N/A','REVIEW'].includes(r.grade)) return false;
    const b = benchForCount.get(String(r.id));
    return !benchmarkRelation(r, b).split;
  }).length;
  $('#gradedCount').textContent = effectiveGraded;
  renderBenchmarkStatus(rows, benchmark);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No gradable fourth-down decisions in this view yet.</td></tr>`;
    return;
  }

  const byId = benchmarkByPlay(benchmark);
  tbody.innerHTML = [...rows].reverse().map(d => {
    const b = byId.get(String(d.id));
    const relation = benchmarkRelation(d, b);
    const offense = d.offense?.abbreviation || '—';
    const defense = d.defense?.abbreviation || '—';
    const downText = Number.isFinite(Number(d.ydstogo)) ? `4th & ${Number(d.ydstogo)}` : '4th down';
    const spot = d.fieldPositionText || (d.yardline100 ? `y100 ${Math.round(d.yardline100)}` : '');
    const sit = `Q${d.quarter ?? '?'} ${d.clock || '—'} • ${downText}${spot ? ` • ${spot}` : ''}`;
    const score = d.scoreText || (Number.isFinite(Number(d.offenseScore)) && Number.isFinite(Number(d.defenseScore))
      ? `${offense} ${d.offenseScore}–${d.defenseScore} ${defense}` : 'Score unavailable');
    const optimalDisplay = d.certainty === 'TOSS-UP' ? `TOSS-UP (${d.optimal || '—'} lean)` : (d.optimal || '—');
    const confidence = d.sensitivity?.confidence || '—';
    const quality = d.stateQuality || (d.verifiedState ? 'VERIFIED' : 'REVIEW');
    const spotAudit = d.fieldPositionSource ? `spot: ${d.fieldPositionSource}${d.fieldPositionSourceConflict ? ' • source-side conflict corrected' : ''}${d.numericFieldConflict ? ' • numeric feed conflict ignored' : ''}` : '';
    const rawGrade = d.reviewRequired || d.grade === 'REVIEW' ? 'REVIEW' : (d.grade || '—');
    const gradeDisplay = relation.split ? 'REVIEW' : rawGrade;
    const teamColor = d.offense?.color ? `#${String(d.offense.color).replace('#','')}` : '#9cff31';
    const playText = d.text || '';
    const optionSummary = d.options && !d.reviewRequired
      ? Object.entries(d.options).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${k} ${(v*100).toFixed(1)}%`).join(' • ')
      : '';
    const benchmarkSummary = benchmarkOptionsText(b);
    const burnDisplay = relation.split ? '—' : fmtBurn(d.wpRegret);
    const modelLabel = relation.split ? `${optimalDisplay} • REVIEW` : optimalDisplay;

    return `<tr class="decisionRow ${quality === 'REVIEW' ? 'reviewRow' : ''} ${relation.split ? 'modelSplitRow' : ''}">
      <td><strong>${esc(d.gameName || selectedGameName || '')}</strong></td>
      <td>
        <span class="teamPill" style="--team-color:${esc(teamColor)}">${esc(offense)}</span>
        <span class="cellSub">vs ${esc(defense)}</span>
      </td>
      <td class="stateCell" title="${esc(playText)}">
        <strong>${esc(score)}</strong>
        <span class="cellSub">${esc(sit)}</span>
        ${spotAudit ? `<span class="dataAudit">${esc(spotAudit)}</span>` : ''}
        ${playText ? `<span class="playText">${esc(playText)}</span>` : ''}
      </td>
      <td><strong>${esc(d.actual || d.actualDecision || '—')}</strong><span class="cellSub">${esc(offense)} chose this</span></td>
      <td>
        <strong>${esc(d.reviewRequired ? 'NOT GRADED' : modelLabel)}</strong>
        <span class="cellSub">${esc(d.reviewRequired ? (d.reason || 'state needs review') : `${confidence} stability • ${quality}`)}</span>
        ${optionSummary ? `<span class="modelOptions">PRIMARY • ${esc(optionSummary)}</span>` : ''}
        ${b ? `<span class="benchmarkLine ${esc(relation.kind)}"><b>${esc(relation.label)}</b><br>NFL4TH • ${esc(benchmarkSummary)}${Number.isFinite(Number(b.edge_pp)) ? ` • edge ${Number(b.edge_pp).toFixed(1)} pp` : ''}</span>` : `<span class="benchmarkLine PRIMARY_ONLY">NFL4TH benchmark not loaded</span>`}
      </td>
      <td>${fmtWp(d.baselineWp)}</td>
      <td>${burnDisplay}</td>
      <td class="grade ${esc(gradeDisplay)}">${esc(gradeDisplay)}</td>
    </tr>`;
  }).join('');
}

async function loadLiveBoard() {
  const status = $('#feedStatus');
  try {
    const r = await fetch('/api/live');
    if (!r.ok) throw new Error('feed');
    const data = await r.json();
    lastLiveData = data;
    document.querySelector('.dot').classList.add('live');
    status.textContent = 'LIVE FEED';
    $('#activeGames').textContent = data.activeGameCount ?? 0;
    $('#liveFourths').textContent = data.pendingFourthDowns?.length ?? 0;
    renderGames(data.games || []);
    renderAlerts(data);
    if (!selectedGameId) renderLedger(data.ledger || [], 'Live fourth-down ledger');

    if (!selectedGameId && data.pendingFourthDowns?.[0]?.evaluation) {
      const p = data.pendingFourthDowns[0];
      showLiveSituation(p, p.gameName);
      renderEvaluation(p.evaluation);
    }
  } catch {
    document.querySelector('.dot').classList.remove('live');
    status.textContent = 'OFFLINE LAB';
    $('#games').innerHTML = `<div class="empty"><b>Live feed unavailable.</b><br><br>The decision lab still works. When internet access returns, the board reconnects automatically.</div>`;
  }
}

function showLiveSituation(p, gameName = '') {
  const box = $('#liveSituation');
  if (!p) {
    box.classList.add('hidden');
    return;
  }
  const offense = p.offense?.abbreviation || 'OFF';
  const defense = p.defense?.abbreviation || 'DEF';
  const score = p.scoreText || `score diff ${p.scoreDiff >= 0 ? '+' : ''}${p.scoreDiff}`;
  const spot = p.fieldPositionText || (p.yardline100 ? `${Math.round(p.yardline100)} yards from goal` : 'field position unavailable');
  box.classList.remove('hidden');
  box.innerHTML = `<span class="kicker">LIVE GAME STATE</span><h3>${esc(offense)} BALL • ${esc(gameName)} • 4th & ${esc(p.ydstogo)}</h3><div class="muted">${esc(score)} • ${esc(p.clock)} Q${esc(p.quarter)} • ${esc(spot)} • vs ${esc(defense)} • pre-decision WP ${fmtWp(p.baselineWp)}</div>`;
}

async function selectGame(id, name = '') {
  selectedGameId = id;
  selectedGameName = name;
  $('#allLiveBtn').classList.remove('activeBtn');
  renderGames(lastLiveData?.games || []);
  await loadSelectedGame();
  clearInterval(selectedTimer);
  selectedTimer = setInterval(loadSelectedGame, 5000);
}

async function loadSelectedGame() {
  if (!selectedGameId) return;
  try {
    const [gameResp, benchmark] = await Promise.all([
      fetch(`/api/game/${encodeURIComponent(selectedGameId)}`),
      getBenchmark(selectedGameId)
    ]);
    if (!gameResp.ok) throw new Error('game');
    const { game } = await gameResp.json();
    selectedBenchmark = benchmark;
    selectedGameName = game.name || selectedGameName;
    renderLedger((game.completedFourthDowns || []).map(d => ({ ...d, gameName: game.name })), `${game.name || 'Selected game'} ledger`, benchmark);
    const p = game.pendingFourthDown;
    if (p?.evaluation) {
      showLiveSituation(p, game.name);
      renderEvaluation(p.evaluation);
    } else if (game.pendingThirdDown?.planning?.twoDownTerritory) {
      const t = game.pendingThirdDown;
      const box = $('#liveSituation');
      box.classList.remove('hidden');
      box.innerHTML = `<span class="kicker">TWO-DOWN TERRITORY</span><h3>${esc(game.name)} • ${esc(t.offense?.abbreviation)} • 3rd & ${esc(t.ydstogo)}</h3><div class="muted">${esc(t.planning.message)}</div>`;
    } else {
      $('#liveSituation').classList.add('hidden');
    }
  } catch {}
}

function returnToAllLive() {
  selectedGameId = null;
  selectedGameName = null;
  selectedBenchmark = null;
  clearInterval(selectedTimer);
  selectedTimer = null;
  $('#allLiveBtn').classList.add('activeBtn');
  $('#liveSituation').classList.add('hidden');
  renderGames(lastLiveData?.games || []);
  renderLedger(lastLiveData?.ledger || [], 'Live fourth-down ledger', null);
}

$('#labForm').addEventListener('submit', evaluateManual);
$('#thirdDownBtn').addEventListener('click', evaluateThirdDown);
$('#refreshBtn').addEventListener('click', loadLiveBoard);
$('#allLiveBtn').addEventListener('click', returnToAllLive);

loadLiveBoard();
evaluateManual();
liveTimer = setInterval(loadLiveBoard, 7000);
