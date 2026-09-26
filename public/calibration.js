const RAW = 'https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/public/calibration';
const $ = s => document.querySelector(s);
const finite = x => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const pct = x => finite(x) == null ? '—' : `${(100 * finite(x)).toFixed(1)}%`;
const pp = x => finite(x) == null ? '—' : `${finite(x).toFixed(2)} pp`;
const nfmt = x => finite(x) == null ? '—' : Math.round(finite(x)).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function getJson(name) {
  const remote = `${RAW}/${name}?ts=${Date.now()}`;
  try {
    const r = await fetch(remote);
    if (r.ok) return r.json();
  } catch {}
  const local = await fetch(`/calibration/${name}?ts=${Date.now()}`);
  if (!local.ok) throw new Error(`${name} unavailable`);
  const ct = local.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`${name} has not been generated yet`);
  return local.json();
}

function clsAgreement(x) {
  const n = finite(x);
  if (n == null) return '';
  if (n >= .9) return 'good';
  if (n >= .8) return 'cyan';
  if (n >= .7) return 'warn';
  return 'bad';
}

function renderKpis(report) {
  const o = report.summary.overall;
  const h = report.summary.holdout;
  const vals = [
    nfmt(o.n),
    pct(o.exactAgreement),
    pct(o.decisionSafeRate),
    pct(h.exactAgreement),
    pp(o.meanReferenceRegretPp),
    pct(o.strongSplitRate)
  ];
  document.querySelectorAll('#kpis strong').forEach((el,i)=> el.textContent = vals[i]);
}

function renderMeta(report) {
  const m = report.referenceMetadata || {};
  $('#meta').textContent = `REFERENCE: nfl4th ${m.nfl4th_version || ''} • SEASONS ${m.start_season || '?'}–${m.end_season || '?'} • HOLDOUT ${report.methodology.holdoutSeason} • INTEGRITY ${report.productVersion || 'v0.4.1'} • GENERATED ${new Date(report.generatedAt).toLocaleString()}`;
}

function splitCard(title, s, note) {
  return `<div class="splitCard">
    <span>${esc(title)}</span>
    <strong class="${clsAgreement(s.exactAgreement)}">${pct(s.exactAgreement)}</strong>
    <p>${nfmt(s.comparableN)} comparable of ${nfmt(s.n)} states • ${pct(s.decisionSafeRate)} within 0.75 pp reference regret • mean regret ${pp(s.meanReferenceRegretPp)}${note ? `<br>${esc(note)}` : ''}</p>
  </div>`;
}

function renderSplitCards(report) {
  $('#splitCards').innerHTML =
    splitCard('OVERALL', report.summary.overall, 'Descriptive, not a tuning target.') +
    splitCard('DEVELOPMENT', report.summary.development, 'Use this sample to diagnose and tune.') +
    splitCard(`HOLDOUT ${report.methodology.holdoutSeason}`, report.summary.holdout, 'Do not tune directly to this season.');
}

function integrityCard(title, value, note, cls = '') {
  return `<div class="splitCard"><span>${esc(title)}</span><strong class="${cls}">${esc(value)}</strong><p>${esc(note)}</p></div>`;
}

function renderIntegrity(report) {
  const o = report.summary.overall;
  $('#integrityCards').innerHTML =
    integrityCard('PRIMARY CALL COVERAGE', pct(o.referenceCoverageRate), `${nfmt(o.comparableN)} of ${nfmt(o.n)} primary choices are priced by nfl4th.`, 'good') +
    integrityCard('FULL 3-OPTION COVERAGE', pct(o.fullReferenceCoverageRate), `${nfmt(o.completeReferenceN)} states have GO, FG and PUNT reference values.`, 'cyan') +
    integrityCard('REFERENCE GAPS', nfmt(o.referenceGapCount), 'Primary chose an action nfl4th did not price. These rows are not assigned reference regret.', o.referenceGapCount ? 'warn' : 'good') +
    integrityCard('GENUINE ZERO WPs', nfmt(o.genuineZeroOptionCount), 'Real numeric 0.0 probabilities are retained. Null/NA values are never converted to zero.', '');
}

function renderOptionErrors(report) {
  const live = report.summary.anchorComparison.liveLike;
  const structural = report.summary.anchorComparison.structural;
  const vegas = report.summary.anchorComparison.vegasAnchor;
  const rows = ['GO','FG','PUNT'].map(a => `<tr>
    <td><b>${a}</b></td>
    <td>${nfmt(live[a]?.n)}</td>
    <td>${pp(live[a]?.maePp)}</td>
    <td>${pp(live[a]?.biasPp)}</td>
    <td>${pp(structural[a]?.maePp)}</td>
    <td>${pp(vegas[a]?.maePp)}</td>
  </tr>`).join('');
  $('#optionErrors').innerHTML = `<table>
    <thead><tr><th>ACTION</th><th>PRICED N</th><th>LIVE-LIKE MAE</th><th>LIVE-LIKE BIAS</th><th>STRUCTURAL MAE</th><th>VEGAS-ANCHOR MAE</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderCertainty(report) {
  const c = report.summary.overall.certainty;
  $('#certainty').innerHTML = `<table>
    <thead><tr><th>PRIMARY LABEL</th><th>ALL N</th><th>COMPARABLE</th><th>EXACT</th><th>≤0.75 PP</th><th>MEAN REGRET</th><th>P95 REGRET</th></tr></thead>
    <tbody>${['CLEAR','LEAN','TOSS-UP'].map(k => `<tr>
      <td><b>${k}</b></td><td>${nfmt(c[k]?.n)}</td><td>${nfmt(c[k]?.comparableN)}</td><td class="${clsAgreement(c[k]?.exactAgreement)}">${pct(c[k]?.exactAgreement)}</td>
      <td>${pct(c[k]?.decisionSafeRate)}</td><td>${pp(c[k]?.meanReferenceRegretPp)}</td><td>${pp(c[k]?.p95ReferenceRegretPp)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderBuckets(report) {
  const key = $('#bucketSelect').value;
  const rows = report.summary.buckets[key] || [];
  const ordered = rows.slice().sort((a,b) => (finite(b.meanReferenceRegretPp) ?? -1) - (finite(a.meanReferenceRegretPp) ?? -1));
  $('#bucketTable').innerHTML = `<table>
    <thead><tr><th>BUCKET</th><th>ALL N</th><th>COMPARABLE</th><th>COVERAGE</th><th>EXACT</th><th>≤0.75 PP</th><th>MEAN REGRET</th><th>P95 REGRET</th><th>STRONG SPLIT</th></tr></thead>
    <tbody>${ordered.map(r => `<tr>
      <td><b>${esc(r.bucket)}</b></td><td>${nfmt(r.n)}</td><td>${nfmt(r.comparableN)}</td><td>${pct(r.referenceCoverageRate)}</td><td class="${clsAgreement(r.exactAgreement)}">${pct(r.exactAgreement)}</td>
      <td>${pct(r.decisionSafeRate)}</td><td>${pp(r.meanReferenceRegretPp)}</td><td>${pp(r.p95ReferenceRegretPp)}</td><td>${pct(r.strongSplitRate)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function optionsText(opts) {
  return ['GO','FG','PUNT']
    .filter(a => finite(opts?.[a]) != null)
    .map(a => `${a} ${(100 * finite(opts[a])).toFixed(1)}%`)
    .join(' • ');
}

function renderSplits(splits) {
  const rows = (splits.rows || []).slice(0, 50);
  $('#splitsTable').innerHTML = `<table>
    <thead><tr><th>GAME</th><th>STATE</th><th>PRIMARY</th><th>NFL4TH</th><th>REF REGRET</th><th>ACTUAL</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><b>${esc(r.gameId)}</b><span class="desc">${esc(r.posteam)} vs ${esc(r.defteam)} • ${esc(r.description)}</span></td>
      <td>Q${r.quarter} ${Math.floor(r.quarterSecondsRemaining/60)}:${String(Math.round(r.quarterSecondsRemaining%60)).padStart(2,'0')}<br>4th & ${esc(r.ydstogo)} • y100 ${esc(r.yardline100)}<br>diff ${r.scoreDiff >= 0 ? '+' : ''}${r.scoreDiff}</td>
      <td><span class="pill">${esc(r.primaryOptimal)}</span><span class="desc">${esc(optionsText(r.primaryOptions))}<br>${esc(r.primaryCertainty)} • edge ${pp(r.primaryEdgePp)}</span></td>
      <td><span class="pill">${esc(r.referenceOptimal)}</span><span class="desc">${esc(optionsText(r.referenceOptions))}<br>${esc(r.referenceCertainty)} • edge ${pp(r.referenceEdgePp)}</span></td>
      <td class="${finite(r.referenceRegretPp) >= 2 ? 'bad' : 'warn'}"><b>${pp(r.referenceRegretPp)}</b></td>
      <td>${esc(r.actual)}<span class="desc">coach regret ${pp(r.coachRegretPp)}</span></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderReferenceGaps(splits) {
  const rows = (splits.referenceGaps || []).slice(0, 50);
  if (!rows.length) {
    $('#referenceGapsTable').innerHTML = '<div class="empty">No primary-call reference gaps.</div>';
    return;
  }
  $('#referenceGapsTable').innerHTML = `<table>
    <thead><tr><th>GAME</th><th>STATE</th><th>PRIMARY</th><th>AVAILABLE NFL4TH OPTIONS</th><th>UNAVAILABLE</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><b>${esc(r.gameId)}</b><span class="desc">${esc(r.posteam)} vs ${esc(r.defteam)} • ${esc(r.description)}</span></td>
      <td>Q${r.quarter} ${Math.floor(r.quarterSecondsRemaining/60)}:${String(Math.round(r.quarterSecondsRemaining%60)).padStart(2,'0')}<br>4th & ${esc(r.ydstogo)} • y100 ${esc(r.yardline100)}<br>diff ${r.scoreDiff >= 0 ? '+' : ''}${r.scoreDiff}</td>
      <td><span class="pill">${esc(r.primaryOptimal)}</span><span class="desc">Not scored for reference regret.</span></td>
      <td>${esc(optionsText(r.referenceOptions)) || '—'}</td>
      <td class="warn"><b>${esc((r.referenceUnavailableActions || []).join(', ') || '—')}</b></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function main() {
  try {
    const [report, splits] = await Promise.all([getJson('report.json'), getJson('splits.json')]);
    $('#statusDot').classList.add('live');
    $('#statusText').textContent = 'CALIBRATION READY';
    renderMeta(report);
    renderKpis(report);
    renderIntegrity(report);
    renderSplitCards(report);
    renderOptionErrors(report);
    renderCertainty(report);
    renderBuckets(report);
    renderSplits(splits);
    renderReferenceGaps(splits);
    $('#bucketSelect').addEventListener('change', () => renderBuckets(report));
  } catch (e) {
    $('#statusText').textContent = 'CALIBRATION NOT RUN';
    $('#meta').textContent = 'Historical calibration output is not available yet. ' + e.message;
    document.querySelectorAll('.panel').forEach(p => {
      if (!p.querySelector('.empty')) p.insertAdjacentHTML('beforeend','<div class="empty">Historical report not available yet.</div>');
    });
  }
}

main();
