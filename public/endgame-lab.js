const RAW='https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/public/calibration';
const $=s=>document.querySelector(s);
const finite=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
const pct=x=>finite(x)==null?'—':`${(100*finite(x)).toFixed(1)}%`;
const pp=x=>finite(x)==null?'—':`${finite(x).toFixed(3)} pp`;
const nfmt=x=>finite(x)==null?'—':Math.round(finite(x)).toLocaleString();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function get(name){
  const r=await fetch(`${RAW}/${name}?ts=${Date.now()}`);
  if(!r.ok) throw new Error(`${name} unavailable`);
  return r.json();
}
function side(label,s){
  return `<div class="side"><span class="label">${esc(label)}</span><div class="metricGrid">
    <div class="metric"><span>EXACT</span><b>${pct(s.exactAgreement)}</b></div>
    <div class="metric"><span>≤0.75 PP</span><b>${pct(s.decisionSafeRate)}</b></div>
    <div class="metric"><span>MEAN REGRET</span><b>${pp(s.meanReferenceRegretPp)}</b></div>
    <div class="metric"><span>STRONG SPLITS</span><b>${pct(s.strongSplitRate)}</b></div>
  </div></div>`;
}
function harmfulTable(rows=[]){
  if(!rows.length) return '<div class="empty">No harmful flips.</div>';
  return `<table><thead><tr><th>GAME</th><th>STATE</th><th>LEGACY → V0.5.1</th><th>NFL4TH</th><th>DAMAGE</th></tr></thead><tbody>${
    rows.map(r=>`<tr>
      <td><b>${esc(r.gameId)}</b><span class="desc">${esc(r.posteam)} vs ${esc(r.defteam)} • ${esc(r.description)}</span></td>
      <td>Q${r.quarter} ${Math.floor(r.quarterSecondsRemaining/60)}:${String(Math.round(r.quarterSecondsRemaining%60)).padStart(2,'0')}<br>4th & ${r.ydstogo} • y100 ${r.yardline100}<br>diff ${r.scoreDiff>=0?'+':''}${r.scoreDiff}</td>
      <td><span class="pill">${esc(r.legacyOptimal)}</span> → <span class="pill">${esc(r.candidateOptimal)}</span><span class="desc">${esc((r.candidateTags||[]).join(' • '))}</span></td>
      <td><span class="pill">${esc(r.referenceOptimal)}</span></td>
      <td class="bad"><b>${(-Number(r.regretImprovementPp)).toFixed(2)} pp</b></td>
    </tr>`).join('')
  }</tbody></table>`;
}
function bootstrapTable(a){
  const rows=[
    ['Overall',a.overall?.regretImprovement],
    ['Final 5 min',a.endgame?.regretImprovement],
    ['Final 2 min',a.finalTwo?.regretImprovement],
    ['Final 60 sec',a.finalMinute?.regretImprovement]
  ];
  return `<table><thead><tr><th>SLICE</th><th>MEAN SAVED</th><th>95% CI</th><th>P(IMPROVEMENT&gt;0)</th></tr></thead><tbody>${
    rows.map(([name,x])=>`<tr><td><b>${name}</b></td><td>${pp(x?.estimate)}</td><td>${finite(x?.lower95)?.toFixed(4)??'—'} to ${finite(x?.upper95)?.toFixed(4)??'—'} pp</td><td class="good">${pct(x?.probabilityPositive)}</td></tr>`).join('')
  }</tbody></table>`;
}
async function main(){
  try{
    const [dev,hold,audit]=await Promise.all([
      get('v051-development.json'),
      get('v051-holdout.json'),
      get('v051-release-audit.json')
    ]);
    $('#dot').classList.add('live');
    $('#status').textContent=`RELEASE ${audit.verdict}`;
    $('#meta').textContent=`2021–2024 DEVELOPMENT PASS • 2025 HOLDOUT ${hold.rowsScored.toLocaleString()} STATES • NFL4TH ${audit.reference?.metadata?.nfl4th_version||'—'} • AUDIT ${audit.verdict}`;
    const vals=[
      nfmt(hold.rowsScored),
      pct(hold.candidate.exactAgreement),
      pct(hold.candidate.decisionSafeRate),
      pp(hold.candidate.meanReferenceRegretPp),
      pp(hold.endgame.finalTwoCandidate.meanReferenceRegretPp),
      audit.verdict
    ];
    document.querySelectorAll('#kpis strong').forEach((e,i)=>{
      e.textContent=vals[i];
      if(i===5)e.className=audit.verdict==='PROMOTE'?'good':'bad';
    });
    $('#comparison').innerHTML=side('LEGACY 2025',hold.legacy)+side('V0.5.1 2025',hold.candidate);
    $('#endgameComparison').innerHTML=side('LEGACY • FINAL 5:00',hold.endgame.legacy)+side('V0.5.1 • FINAL 5:00',hold.endgame.candidate);
    const f=audit.flips;
    $('#flips').innerHTML=`<div class="flipCards">
      <div class="flipCard"><span>TOTAL FLIPS</span><b>${nfmt(f.total)}</b></div>
      <div class="flipCard"><span>BENEFICIAL</span><b class="good">${nfmt(f.beneficial)}</b></div>
      <div class="flipCard"><span>HARMFUL</span><b class="bad">${nfmt(f.harmful.length||f.harmful)}</b></div>
      <div class="flipCard"><span>NET REGRET SAVED</span><b class="cyan">${pp(f.netReferenceRegretSavedPp)}</b></div>
    </div>`;
    $('#criteria').innerHTML=Object.entries(audit.releaseGate?.criteria||{}).map(([k,v])=>`<div class="criteriaRow"><span>${esc(k.replace(/([A-Z])/g,' $1'))}</span><b class="${v?'good':'bad'}">${v?'PASS':'FAIL'}</b></div>`).join('');
    $('#harms').innerHTML=harmfulTable(Array.isArray(f.harmful)?f.harmful:[]);
    $('#holdout').innerHTML=bootstrapTable(audit.bootstrap);
    $('#holdoutBanner').textContent=`✅ RELEASE AUDIT: ${audit.verdict}`;
  }catch(e){
    $('#status').textContent='RELEASE EVIDENCE UNAVAILABLE';
    $('#meta').textContent=e.message;
  }
}
main();
