// Offline preparation only. Never connects to a database or applies the output SQL.
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const [analysisPath, snapshotPath, workbookPath, outputPrefix] = process.argv.slice(2)
if (!outputPrefix) throw new Error('Usage: node scripts/prepare-leave-baseline.mjs analysis.json snapshot.json source.xlsx output-prefix')
const source = JSON.parse(await fs.readFile(analysisPath,'utf8'))
const snapshot = JSON.parse(await fs.readFile(snapshotPath,'utf8'))
const hash = crypto.createHash('sha256').update(await fs.readFile(workbookPath)).digest('hex')
const day = '2026-10-29'
const matched=[], skipped=[]
for (const row of source.filter(row=>!row.hidden)) {
  const people = snapshot.staff.filter(p=>p.name?.trim()===row.name.trim() && p.status==='active')
  if (people.length!==1) { skipped.push({name:row.name,reason:people.length?'동명이인 확인 필요':'사이트 미등록'}); continue }
  const person=people[0],hire=row.hire.slice(0,10)
  assert.match(hire,/^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Number.isFinite(row.earned)&&row.earned>=0&&Number.isFinite(row.remaining))
  assert.ok(row.earned-row.usage.reduce((sum,u)=>sum+u.days,0)===row.remaining,'엑셀 캐시 잔여 재확인')
  if(hire!==person.hire_date) assert.ok(['김선영','김보영'].includes(row.name),'승인되지 않은 입사일 변경')
  assert.ok(!snapshot.ledger.some(e=>e.employee_id===person.id),'신규 차감 내역이 있어 재대조 필요')
  matched.push({id:person.id,company:person.company_id,name:row.name,oldHire:person.hire_date,hire,oldRemaining:person.remaining===null?null:Number(person.remaining),grant:row.earned,remaining:row.remaining,grantCell:`F${row.row}`,remainingCell:`X${row.row}`,rosterExists:person.roster_exists})
}
assert.equal(new Set(matched.map(p=>p.id)).size,matched.length)
const report={asOf:day,source:workbookPath,sha256:hash,matched,skipped,historyImported:false}
await fs.writeFile(outputPrefix+'.json',JSON.stringify(report,null,2))
const literal=value=>value==null?'null':"'"+String(value).replaceAll("'","''")+"'"
const payload=literal(JSON.stringify(matched))
const sql=`-- Prepared from 연차,반차 F/X only; no usage dates or leave applications imported.
begin;
create temporary table leave_baseline_input on commit drop as
select * from jsonb_to_recordset(${payload}::jsonb) as x(id uuid,company uuid,name text,"oldHire" date,hire date,"oldRemaining" numeric,"grant" numeric,remaining numeric,"grantCell" text,"remainingCell" text,"rosterExists" boolean);
do $apply$
declare r record;
begin
  if (now() at time zone 'Asia/Seoul')::date<>date '${day}' then raise exception '기준일이 변경되었습니다. 재대조가 필요합니다.'; end if;
  for r in select * from leave_baseline_input order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.id::text,0));
    perform 1 from public.profiles where id=r.id for update;
    perform 1 from public.employee_roster where profile_id=r.id for update;
    if not exists(select 1 from public.profiles p where p.id=r.id and p.company_id=r.company and p.display_name=r.name and p.status='active' and p.hire_date is not distinct from r."oldHire") then raise exception '직원 정보가 변경되었습니다: %',r.name; end if;
    if exists(select 1 from app.employee_leave_accrual where employee_id=r.id) then raise exception '이미 초기화된 직원입니다: %',r.name; end if;
    if exists(select 1 from app.leave_balance_entries where employee_id=r.id) then raise exception '새 휴가 등록이 있습니다. 잔여값 재대조가 필요합니다: %',r.name; end if;
    if (exists(select 1 from public.employee_roster where profile_id=r.id)) is distinct from r."rosterExists"
      or (select remaining_annual_leave from public.employee_roster where profile_id=r.id) is distinct from r."oldRemaining" then raise exception '잔여값이 변경되었습니다: %',r.name; end if;
  end loop;
  perform pg_catalog.set_config('app.roster_import','on',true);
  update public.profiles p set hire_date=i.hire from leave_baseline_input i where p.id=i.id and p.hire_date is distinct from i.hire;
  insert into public.employee_roster(profile_id,company_id,accrued_annual_leave,remaining_annual_leave)
    select id,company,"grant",remaining from leave_baseline_input
    on conflict(profile_id) do update set accrued_annual_leave=excluded.accrued_annual_leave,remaining_annual_leave=excluded.remaining_annual_leave;
  insert into app.employee_leave_accrual(employee_id,company_id,hire_date,cycle_start,cycle_end,calculated_grant,source_key)
    select i.id,i.company,i.hire,c.starts_on,c.ends_on,greatest(c.grant_days,i."grant"),'xlsx:${hash}'
    from leave_baseline_input i cross join lateral app.employee_leave_cycle(i.hire,date '${day}') c;
  if (select count(*) from app.employee_leave_accrual where source_key='xlsx:${hash}')<>${matched.length} then raise exception '초기화 인원 불일치'; end if;
  if exists(select 1 from leave_baseline_input i join public.employee_roster roster on roster.profile_id=i.id where roster.accrued_annual_leave is distinct from i."grant" or roster.remaining_annual_leave is distinct from i.remaining) then raise exception '엑셀 값 대조 실패'; end if;
  perform pg_catalog.set_config('app.roster_import','',true);
end $apply$;
do $schedule$ begin
  if exists(select 1 from cron.job where jobname='atelier-leave-anniversary-accrual') then raise exception '동일 이름의 작업이 있습니다. 덮어쓰지 않습니다.'; end if;
end $schedule$;
select cron.schedule('atelier-leave-anniversary-accrual','0 15 * * *','select app.refresh_company_leave_balances();');
commit;
`
await fs.writeFile(outputPrefix+'.sql',sql)
console.log(JSON.stringify({matched:matched.length,skipped,hireChanges:matched.filter(r=>r.hire!==r.oldHire).map(r=>({name:r.name,from:r.oldHire,to:r.hire})),grantTotal:matched.reduce((s,r)=>s+r.grant,0),remainingTotal:matched.reduce((s,r)=>s+r.remaining,0),historyImported:false}))
