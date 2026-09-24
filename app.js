const $ = (s) => document.querySelector(s);
const fmtWp = (x) => x == null ? '—' : `${(x * 100).toFixed(1)}%`;
const fmtBurn = (x) => x == null ? '—' : x < .0005 ? '0.0' : `-${(x * 100).toFixed(1)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let selectedGameId = null;
let selectedGameName = null;
let lastLiveData = null;
let liveTimer = null;
let selectedTimer = null;

function badgeClass(certainty) {
  return certainty === 'CLEAR' ? 'clear' : certainty === 'LEAN' ? 'lean' : 'neutral';
}

function renderEvaluation(ev) {
  if (!ev?.options) return;
  const entries = Object.entries(ev.options).sort((a, b) => b[1] - a[1]);
  $('#decisionTitle').textContent = 'Optimal call';
  const badge = $('#certaintyBadge');
  badge.textContent = `${ev.certainty} • ${ev.sensitivity?.confidence || '—'} CONF`;
  badge.className = `badge ${badgeClass(ev.certainty)}`;

  const max = Math.max(...entries.map(x => x[1]));
  const min = Math.min(...entries.map(x => x[1]));
  const range = Math.max(.02, max - min);

  $('#decisionOutput').innerHTML = `
    <div class="rec">
      <div class="recCall">
        <small>RECOMMENDATION</small>
        <strong>${esc(ev.optimal)}</strong>
        <div class="muted">+${(ev.edge * 100).toFixed(1)} WP vs next-best</div>
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

function renderLedger(rows = [], title = 'Live fourth-down ledger') {
  $('#ledgerTitle').textContent = title;
  const tbody = $('#decisionFeed tbody');
  $('#gradedCount').textContent = rows.filter(r => r.grade && r.grade !== 'N/A').length;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No gradable fourth-down decisions in this view yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...rows].reverse().map(d => {
    const sit = `Q${d.quarter} ${d.clock} • 4&${d.ydstogo}${d.yardline100 ? ` • y100 ${Math.round(d.yardline100)}` : ''}`;
    return `<tr>
      <td>${esc(d.gameName || selectedGameName || '')}</td>
      <td title="${esc(d.text || '')}">${esc(sit)}</td>
      <td>${esc(d.actual || d.actualDecision || '—')}</td>
      <td>${esc(d.optimal || '—')}</td>
      <td>${fmtWp(d.baselineWp)}</td>
      <td>${fmtBurn(d.wpRegret)}</td>
      <td>${esc(d.sensitivity?.confidence || '—')}</td>
      <td class="grade ${esc(d.grade || '')}">${esc(d.grade || '—')}</td>
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
  box.classList.remove('hidden');
  box.innerHTML = `<span class="kicker">LIVE GAME STATE</span><h3>${esc(gameName)} • ${esc(p.offense?.abbreviation)} • 4th & ${esc(p.ydstogo)}</h3><div class="muted">${esc(p.clock)} Q${esc(p.quarter)} • score diff ${p.scoreDiff >= 0 ? '+' : ''}${esc(p.scoreDiff)} • ${Math.round(p.yardline100)} yards from goal • pre-decision WP ${fmtWp(p.baselineWp)}</div>`;
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
    const r = await fetch(`/api/game/${encodeURIComponent(selectedGameId)}`);
    if (!r.ok) throw new Error('game');
    const { game } = await r.json();
    selectedGameName = game.name || selectedGameName;
    renderLedger((game.completedFourthDowns || []).map(d => ({ ...d, gameName: game.name })), `${game.name || 'Selected game'} ledger`);
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
  clearInterval(selectedTimer);
  selectedTimer = null;
  $('#allLiveBtn').classList.add('activeBtn');
  $('#liveSituation').classList.add('hidden');
  renderGames(lastLiveData?.games || []);
  renderLedger(lastLiveData?.ledger || [], 'Live fourth-down ledger');
}

$('#labForm').addEventListener('submit', evaluateManual);
$('#thirdDownBtn').addEventListener('click', evaluateThirdDown);
$('#refreshBtn').addEventListener('click', loadLiveBoard);
$('#allLiveBtn').addEventListener('click', returnToAllLive);

loadLiveBoard();
evaluateManual();
liveTimer = setInterval(loadLiveBoard, 7000);
