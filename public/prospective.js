const RAW='https://raw.githubusercontent.com/sahoool13-jpg/fourth-down-grader/main/data/prospective/2026/summary.json';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
const pct=x=>finite(x)==null?'—':`${(100*Number(x)).toFixed(1)}%`;
const pp=x=>finite(x)==null?'—':`${Number(x).toFixed(2)} pp`;
const n=x=>finite(x)==null?'—':Math.round(Number(x)).toLocaleString();

function gradeClass(g){
  if(['A+','A','B'].includes(String(g)))return'good';
  if(['D','F'].includes(String(g)))return'bad';
  return'';
}
function healthClass(s){
  if(s==='STABLE')return'good';
  if(['REVIEW','V06_RESEARCH_ELIGIBLE'].includes(s))return'review';
  return'';
}
function stateText(r){
  const y=r.yardline100==null?'?':`y100 ${r.yardline100}`;
  return `Q${r.quarter??'?'} ${r.clock||'—'} • 4th & ${r.ydstogo??'?'} • ${y} • diff ${Number(r.scoreDiff)>=0?'+':''}${r.scoreDiff??'?'}`;
}
function progressCard(label,value,target){
  const p=Math.max(0,Math.min(100,target?100*value/target:0));
  return `<div class="progressCard"><div class="row"><span>${esc(label)}</span><b>${n(value)} / ${n(target)}</b></div><div class="track"><div class="fill" style="width:${p}%"></div></div></div>`;
}
function render(d){
  $('.dot').classList.add('live');
  $('#status').textContent=d.status==='ACTIVE'?'ARCHIVE ACTIVE':'WAITING FOR ELIGIBLE GAMES';
  $('#startText').textContent=`Prospective boundary: ${new Date(d.monitorStartAt).toLocaleString()}. Games already underway before this point are excluded.`;
  const k=[
    n(d.sample.archived),
    n(d.sample.gradable),
    n(d.sample.referenceComparable),
    pp(d.coachModel?.meanModelWpaBurnPp),
    pct(d.coachModel?.exactCoachModelAgreement),
    d.modelHealth?.state||'—'
  ];
  document.querySelectorAll('#kpis strong').forEach((e,i)=>{
    e.textContent=k[i];
    if(i===5)e.className=healthClass(k[i]);
  });

  $('#healthHeadline').textContent=d.modelHealth?.headline||'Waiting for sample';
  $('#updatedAt').textContent=d.lastMaterialUpdateAt?`Archive updated ${new Date(d.lastMaterialUpdateAt).toLocaleString()}`:'No material archive update yet';
  $('#progress').innerHTML=
    progressCard('Gradable decisions',d.sample.gradable,d.maturity.totalGradableTarget)+
    progressCard('nfl4th comparable',d.sample.referenceComparable,d.maturity.referenceComparableTarget)+
    progressCard('Endgame reference',d.sample.endgameReferenceComparable,d.maturity.endgameReferenceComparableTarget);

  const triggers=d.modelHealth?.triggers||[];
  $('#triggers').innerHTML=triggers.length
    ?triggers.map(t=>`<div class="trigger ${t.severity==='RESEARCH'?'bad':'review'}"><b>${esc(t.code)}</b> • ${esc(t.detail)}</div>`).join('')
    :`<div class="trigger good">No preregistered 2026 drift trigger is active.</div>`;

  const teams=d.teams||[];
  $('#teamsTable tbody').innerHTML=teams.length?teams.map(t=>`<tr>
    <td><span class="teamPill">${esc(t.team)}</span></td>
    <td>${n(t.gradable)}</td>
    <td>${pct(t.exactCoachModelAgreement)}</td>
    <td>${pct(t.actualGoRate)}</td>
    <td>${pct(t.modelGoRate)}</td>
    <td class="burn">${pp(t.meanModelWpaBurnPp)}</td>
    <td class="burn ${Number(t.totalModelWpaBurnPp)>=10?'high':''}">${pp(t.totalModelWpaBurnPp)}</td>
    <td>${n(t.costlyMistakes2Pp)}</td>
  </tr>`).join(''):'<tr><td colspan="8" class="empty">No eligible decisions yet.</td></tr>';

  const ref=d.reference||{};
  $('#referenceCards').innerHTML=[
    ['EXACT',pct(ref.exactAgreement)],
    ['≤0.75 PP',pct(ref.decisionSafeRate)],
    ['MEAN REGRET',pp(ref.meanReferenceRegretPp)],
    ['STRONG SPLITS',pct(ref.strongSplitRate)],
    ['V051 ↔ LEGACY FLIPS',n(ref.v051VsLegacy?.flips)],
    ['NET REGRET SAVED',pp(ref.v051VsLegacy?.netReferenceRegretSavedPp)]
  ].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('');

  $('#pipeline').innerHTML=Object.entries(d.benchmarkPipeline||{}).map(([k,v])=>`<span>${esc(k)}: <b>${n(v)}</b></span>`).join('');

  const mistakes=d.biggestMistakes||[];
  $('#mistakesTable tbody').innerHTML=mistakes.length?mistakes.map(r=>`<tr>
    <td><b>${esc(r.gameName)}</b><span class="desc">${esc(r.description||'')}</span></td>
    <td>${esc(stateText(r))}</td>
    <td><span class="callPill">${esc(r.actual)}</span></td>
    <td><span class="callPill">${esc(r.optimal)}</span><span class="desc">${esc((r.endgameTags||[]).join(' • '))}</span></td>
    <td class="burn ${Number(r.modelWpaBurnPp)>=5?'high':''}">${pp(r.modelWpaBurnPp)}</td>
    <td><span class="grade ${gradeClass(r.grade)}">${esc(r.grade||'—')}</span></td>
    <td>${r.referenceOptimal?`<span class="callPill">${esc(r.referenceOptimal)}</span><span class="desc">${pp(r.referenceRegretPp)} ref regret</span>`:'<span class="muted">pending</span>'}</td>
  </tr>`).join(''):'<tr><td colspan="7" class="empty">No eligible decisions yet.</td></tr>';

  const recent=d.recent||[];
  $('#recentTable tbody').innerHTML=recent.length?recent.map(r=>`<tr>
    <td>${r.capturedAt?new Date(r.capturedAt).toLocaleString():'—'}</td>
    <td><b>${esc(r.gameName)}</b></td>
    <td><span class="teamPill">${esc(r.offense)}</span> vs ${esc(r.defense)}</td>
    <td>${esc(stateText(r))}</td>
    <td><span class="callPill">${esc(r.actual)}</span></td>
    <td><span class="callPill">${esc(r.optimal)}</span></td>
    <td class="burn">${pp(r.modelWpaBurnPp)}</td>
    <td>${r.referenceOptimal?`<span class="callPill">${esc(r.referenceOptimal)}</span>`:`<span class="muted">${esc(r.referenceStatus)}</span>`}</td>
  </tr>`).join(''):'<tr><td colspan="8" class="empty">Waiting for the first eligible fourth down.</td></tr>';
}

async function load(){
  try{
    const r=await fetch(`${RAW}?ts=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`Archive HTTP ${r.status}`);
    render(await r.json());
  }catch(e){
    $('#status').textContent='ARCHIVE UNAVAILABLE';
    $('#healthHeadline').textContent=e.message;
  }
}
load();
setInterval(load,300000);
