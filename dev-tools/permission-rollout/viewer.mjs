const $=id=>document.getElementById(id)
const make=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
const statuses={active:'승인됨',pending:'승인 대기',rejected:'반려',disabled:'비활성'}
const simulations=new Map()
let selected=null, report

function showGrants(grants) {
  const d=make('details'),s=make('summary',`${grants.length}개 권한 보기`);d.append(s)
  for(const g of grants){const item=make('div',g.label,'grant');item.append(make('small',g.scopeName));d.append(item)}
  return d
}
function botDetail(bot) {
  selected=bot.id
  const panel=$('bot-detail');panel.replaceChildren()
  panel.append(make('h3',bot.name),make('span','가상 인물 · 실제 계정 없음','pill'),make('p',`${bot.departmentName} / ${bot.position} · 직책·직급만으로 업무 권한이 생기지 않습니다.`))
  const state=simulations.get(bot.id)??{grants:new Set(),grade:''};simulations.set(bot.id,state)
  const toolbar=make('div',undefined,'filters'),gradeLabel=make('label','가상 직급'),grade=make('select')
  grade.setAttribute('aria-label','가상 직급')
  grade.append(new Option('직급 미지정',''))
  for(const t of report.titles.filter(t=>t.companyId===bot.companyId&&t.kind==='grade'))grade.append(new Option(t.name,t.name))
  grade.value=state.grade;grade.addEventListener('change',()=>{state.grade=grade.value;updateSummary()});gradeLabel.append(grade)
  const reset=make('button','이 봇 지정 초기화','reset');reset.addEventListener('click',()=>{simulations.delete(bot.id);botDetail(bot)})
  toolbar.append(gradeLabel,reset);panel.append(toolbar)
  const summary=make('p',undefined,'sim-result');summary.setAttribute('aria-live','polite');panel.append(summary)
  const permissions=make('div',undefined,'permissions')
  for(const p of report.permissions){const label=make('label'),input=make('input');input.type='checkbox';input.checked=state.grants.has(p.code);input.dataset.permission=p.code;input.addEventListener('change',()=>{if(input.checked)state.grants.add(p.code);else state.grants.delete(p.code);updateSummary()});label.append(input,document.createTextNode(p.label));permissions.append(label)}
  panel.append(permissions,make('p','여기의 지정은 회사 전체 범위로 가정한 화면 내 모의 실험입니다. 부서·업체 범위 및 서버 차단은 별도 검증 결과에서 확인하세요. 새로고침하면 모두 초기화됩니다.','muted'))
  function updateSummary(){summary.textContent=state.grants.size?`명시적으로 지정한 ${state.grants.size}개만 허용 · 직급: ${state.grade||'미지정'} · 직급과 무관`:'지정된 권한 없음 · 대표이사·팀장 직책이어도 자동 권한 없음'}
  updateSummary()
  for(const button of $('bot-list').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.id===bot.id))
}
function botList(){
  const dept=$('department').value,position=$('position').value,search=$('bot-search').value.trim().toLowerCase()
  const bots=report.bots.filter(b=>(!dept||b.departmentId===dept)&&(!position||b.position===position)&&(!search||b.name.toLowerCase().includes(search)))
  $('bot-count').textContent=`전체 ${report.bots.length}명 / 검색 ${bots.length}명`
  $('bot-list').replaceChildren()
  for(const bot of bots){const item=make('div'),button=make('button',bot.name);item.setAttribute('role','listitem');button.dataset.id=bot.id;button.setAttribute('aria-pressed',String(selected===bot.id));button.addEventListener('click',()=>botDetail(bot));item.append(button);$('bot-list').append(item)}
  // Do not keep a hidden person's editable simulation selected after changing the filters.
  if(!bots.some(b=>b.id===selected)){selected=null;$('bot-detail').replaceChildren(make('h3','봇을 선택하세요'))}
}
function render(data){
  report=data
  const stats=[['기존 사용자',data.counts.profiles],['원본 승인자 지정',data.counts.approvers],['부서',data.counts.departments],['가상 봇',data.counts.bots]]
  for(const [label,count]of stats){const s=make('div',undefined,'stat');s.append(make('b',String(count)),make('span',label));$('summary').append(s)}
  $('captured').textContent=`읽기 전용 스냅샷 기준 ${new Date(data.capturedAt).toLocaleString('ko-KR')} · 운영 전환 미적용`
  $('comparison-limit').textContent=data.comparisonLimit
  if(data.blockers.length){$('review-warning').hidden=false;$('review-warning').textContent=`전환 전 확인할 권한 차이 ${data.blockers.length}건: ${data.blockers.join(' / ')}`}
  for(const person of data.people){const row=make('tr'),name=make('td');name.append(make('strong',person.name),make('small',`${person.department} · ${person.position||'직책 미지정'}`));row.append(name)
    const status=make('td');status.append(make('span',`${statuses[person.status]??person.status} → 유지`,'pill'+(person.status==='active'?'':' pending')));row.append(status)
    const before=make('td'),after=make('td'),diff=make('td',undefined,'delta');before.append(showGrants(person.previous));after.append(showGrants(person.next))
    for(const g of person.added)diff.append(make('div',`+ ${g.label} · ${g.scopeName}`))
    for(const g of person.removed)diff.append(make('div',`− ${g.label} · ${g.scopeName}`))
    for(const note of person.notes)diff.append(make('small',note))
    if(!person.added.length&&!person.removed.length)diff.append(make('span','변동 없음'))
    row.append(before,after,diff);$('people-rows').append(row)
  }
  for(const a of data.approvers){const row=make('tr');for(const value of [a.department,({leave:'근태·휴가',overtime:'야근'}[a.type]??a.type),a.approver,a.substitute,'원본 유지'])row.append(make('td',value));$('approver-rows').append(row)}
  for(const c of data.checks){const item=make('div',undefined,'check');item.append(make('b',c.passed?'✓ 통과':'실패'),document.createTextNode(c.name),make('small',c.detail));$('check-list').append(item)}
  for(const d of data.departments)$('department').append(new Option(d.name+(d.isActive?'':' (비활성)'),d.id))
  for(const position of [...new Set(data.bots.map(b=>b.position))])$('position').append(new Option(position,position))
  for(const id of ['department','position','bot-search'])$(id).addEventListener(id==='bot-search'?'input':'change',botList)
  botList()
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  for(const other of document.querySelectorAll('[data-tab]')){other.setAttribute('aria-selected',String(other===button));$(other.dataset.tab).hidden=other!==button}
})
try{const response=await fetch('/report.json',{cache:'no-store'});if(!response.ok)throw new Error('점검 자료를 먼저 생성해야 합니다.');render(await response.json())}
catch(error){$('error').hidden=false;$('error').textContent=error.message;console.warn('[permission-viewer] 점검 자료 로드 실패',error)}
