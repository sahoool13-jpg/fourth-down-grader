const RAW = 'https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/public/calibration';
const $ = s => document.querySelector(s);
const pct = x => Number.isFinite(Number(x)) ? `${(100 * Number(x)).toFixed(1)}%` : '—';
const pp = x => Number.isFinite(Number(x)) ? `${Number(x).toFixed(2)} pp` : '—';
const nfmt = x => Number.isFinite(Number(x)) ? Math.round(Number(x)).toLocaleString() : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function getJson(name) {
  const remote = `${RAW}/${name}?ts=${Date.now()}`;
  try {
    const r = await fetch(remote);
    if (r.ok) return r.json();
  } catch {}
  const local = await fetch(`/calibration/${name}?ts=${Date.now()}`);
  if (!local.ok) throw new Error(`${name} unavailable`);
  return local.json();
}

function clsAgreement(x) {
  if (!Number.isFinite(Number(x))) return '';
  if (x >= .9) return 'good';
  if (x >= .8) return 'cyan';
  if (x >= .7) return 'warn';
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
  $('#meta').textContent = `REFERENCE: nfl4th ${m.nfl4th_version || ''} • SEASONS ${m.start_season || '?'}–${m.end_season || '?'} • HOLDOUT ${report.methodology.holdoutSeason} • GENERATED ${new Date(report.generatedAt).toLocaleString()}`;
}

function splitCard(title, s, note) {
  return `<div class="splitCard">
    <span>${esc(title)}</span>
    <strong class="${clsAgreement(s.exactAgreement)}">${pct(s.exactAgreement)}</strong>
    <p>${nfmt(s.n)} decisions • ${pct(s.decisionSafeRate)} within 0.75 pp reference regret • mean regret ${pp(s.meanReferenceRegretPp)}${note ? `<br>${esc(note)}` : ''}</p>
  </div>`;
}

function renderSplitCards(report) {
  $('#splitCards').innerHTML =
    splitCard('OVERALL', report.summary.overall, 'Descriptive, not a tuning target.') +
    splitCard('DEVELOPMENT', report.summary.development, 'Use this sample to diagnose and tune.') +
    splitCard(`HOLDOUT ${report.methodology.holdoutSeason}`, report.summary.holdout, 'Do not tune directly to this season.');
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
    <thead><tr><th>ACTION</th><th>N</th><th>LIVE-LIKE MAE</th><th>LIVE-LIKE BIAS</th><th>STRUCTURAL MAE</th><th>VEGAS-ANCHOR MAE</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderCertainty(report) {
  const c = report.summary.overall.certainty;
  $('#certainty').innerHTML = `<table>
    <thead><tr><th>PRIMARY LABEL</th><th>N</th><th>EXACT</th><th>≤0.75 PP</th><th>MEAN REGRET</th><th>P95 REGRET</th></tr></thead>
    <tbody>${['CLEAR','LEAN','TOSS-UP'].map(k => `<tr>
      <td><b>${k}</b></td><td>${nfmt(c[k]?.n)}</td><td class="${clsAgreement(c[k]?.exactAgreement)}">${pct(c[k]?.exactAgreement)}</td>
      <td>${pct(c[k]?.decisionSafeRate)}</td><td>${pp(c[k]?.meanReferenceRegretPp)}</td><td>${pp(c[k]?.p95ReferenceRegretPp)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderBuckets(report) {
  const key = $('#bucketSelect').value;
  const rows = report.summary.buckets[key] || [];
  const ordered = rows.slice().sort((a,b) => (b.meanReferenceRegretPp ?? -1) - (a.meanReferenceRegretPp ?? -1));
  $('#bucketTable').innerHTML = `<table>
    <thead><tr><th>BUCKET</th><th>N</th><th>EXACT</th><th>≤0.75 PP</th><th>MEAN REGRET</th><th>P95 REGRET</th><th>STRONG SPLIT</th></tr></thead>
    <tbody>${ordered.map(r => `<tr>
      <td><b>${esc(r.bucket)}</b></td><td>${nfmt(r.n)}</td><td class="${clsAgreement(r.exactAgreement)}">${pct(r.exactAgreement)}</td>
      <td>${pct(r.decisionSafeRate)}</td><td>${pp(r.meanReferenceRegretPp)}</td><td>${pp(r.p95ReferenceRegretPp)}</td><td>${pct(r.strongSplitRate)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function optionsText(opts) {
  return ['GO','FG','PUNT']
    .filter(a => Number.isFinite(Number(opts?.[a])))
    .map(a => `${a} ${(100*Number(opts[a])).toFixed(1)}%`)
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
      <td class="${(r.referenceRegretPp ?? 0) >= 2 ? 'bad' : 'warn'}"><b>${r.unsupportedPrimary ? 'UNSUPPORTED' : pp(r.referenceRegretPp)}</b></td>
      <td>${esc(r.actual)}<span class="desc">coach regret ${pp(r.coachRegretPp)}</span></td>
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
    renderSplitCards(report);
    renderOptionErrors(report);
    renderCertainty(report);
    renderBuckets(report);
    renderSplits(splits);
    $('#bucketSelect').addEventListener('change', () => renderBuckets(report));
  } catch (e) {
    $('#statusText').textContent = 'CALIBRATION NOT RUN';
    $('#meta').textContent = 'Push v0.4, then let the GitHub historical-calibration workflow finish. ' + e.message;
    document.querySelectorAll('.panel').forEach(p => {
      if (!p.querySelector('.empty')) p.insertAdjacentHTML('beforeend','<div class="empty">Historical report not available yet.</div>');
    });
  }
}

main();
