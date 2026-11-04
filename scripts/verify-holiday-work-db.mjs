import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Isolated, disposable PostgreSQL. No production URL, employee or data is used.
const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001', otherCompany = 'e0000000-0000-4000-8000-000000000002'
const staff = '10000000-0000-4000-8000-000000000001', approver = '10000000-0000-4000-8000-000000000002'
const ops = '10000000-0000-4000-8000-000000000003', peer = '10000000-0000-4000-8000-000000000004', foreign = '10000000-0000-4000-8000-000000000005'
const dept = 'd0000000-0000-4000-8000-000000000001', otherDept = 'd0000000-0000-4000-8000-000000000002'
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated') }
const call = async (action, payload = {}) => value('select public.holiday_work($1,$2)', [action, payload])
const list = async (scope = 'mine', month = '2026-10-01') => call('list', { scope, month })
const notices = () => value('select public.list_my_home_work_notifications()')
const oldSnapshot = async () => value(`select jsonb_build_object('profiles',(select jsonb_agg(p order by id) from public.profiles p),'clocks',(select jsonb_agg(c order by id) from public.attendance_clock_ins c),'requests',(select jsonb_agg(r order by id) from public.company_leave_requests r),'roster',(select jsonb_agg(r order by employee_id) from app.employee_roster r),'oldReads',(select jsonb_agg(r order by reader_id,event_key) from public.my_home_notification_reads r where event_key='old-event'),'policies',(select jsonb_agg(p order by tablename,policyname) from pg_policies p where tablename in ('profiles','attendance_clock_ins','company_leave_requests','employee_roster','my_home_notification_reads')),'tableGrants',(select jsonb_agg(t order by table_name,grantee,privilege_type) from information_schema.role_table_grants t where table_name in ('profiles','attendance_clock_ins','company_leave_requests','employee_roster','my_home_notification_reads')))`)
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema app,auth,public to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.departments(id uuid primary key,name text);
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
    create table app.employee_roster(employee_id uuid primary key,remaining_leave numeric);
    create table app.leave_balance_calendar_years(year integer primary key);
    create table app.leave_balance_holidays(day date primary key,label text);
    create table public.attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,unique(employee_id,work_date));
    create table public.company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean default false,offsite_continuous boolean default false);
    create table public.offsite_settlements(id uuid primary key default gen_random_uuid(),request_id uuid,mode text,minutes_by_date jsonb);
    create table public.overtime_actual_reports(id uuid primary key default gen_random_uuid(),request_id uuid,start_at timestamptz,end_at timestamptz,break_minutes integer default 0);
    create table app.employee_extra_leave(id uuid primary key,employee_id uuid,days numeric,expires_on date,note text,deleted_at timestamptz);
    create table public.my_home_notification_reads(reader_id uuid,event_key text,read_at timestamptz default now(),primary key(reader_id,event_key));
    create table app.test_approvers(employee_id uuid,department_id uuid);
    create function app.meeting_company_id() returns uuid language sql stable security definer set search_path='' as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function app.can_edit_org_assignment() returns boolean language sql stable as $$select false$$;
    create function app.basic_work_allowed(text) returns boolean language sql stable as $$select auth.uid()='${ops}'::uuid$$;
    create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from app.test_approvers a join public.profiles p on p.id=a.employee_id where a.employee_id=auth.uid() and a.department_id=$2 and p.company_id=$1 and $3='overtime')$$;
    create function app.save_employee_extra_leave(p_id uuid,p_employee uuid,p_days numeric,p_expires date,p_note text,p_version integer,p_delete boolean) returns uuid language plpgsql security definer set search_path='' as $$begin if not app.basic_work_allowed('operations') then raise exception 'not operations';end if;insert into app.employee_extra_leave values(p_id,p_employee,p_days,p_expires,p_note,null);return p_id;end$$;
    create function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$select '[{"event_key":"old-event","entity_id":"old","read_at":"2026-09-01","event_type":"result"}]'::jsonb$$;
    create function public.read_my_home_work_notification(p_key text) returns void language plpgsql security definer set search_path='' as $$begin if not exists(select 1 from jsonb_array_elements(public.list_my_home_work_notifications()) e where e->>'event_key'=p_key) then raise exception '읽음 권한 없음' using errcode='42501';end if;insert into public.my_home_notification_reads values(auth.uid(),p_key,clock_timestamp()) on conflict do nothing;end$$;
    insert into public.companies values('${company}'),('${otherCompany}');
    insert into public.departments values('${dept}','디자인'),('${otherDept}','기타');
    insert into public.profiles values('${staff}','${company}','${dept}','active','직원'),('${approver}','${company}','${dept}','active','승인자'),('${ops}','${company}','${otherDept}','active','운영지원'),('${peer}','${company}','${otherDept}','active','무관한 직원'),('${foreign}','${otherCompany}','${dept}','active','다른 회사');
    insert into app.employee_roster values('${staff}',7);
    insert into app.test_approvers values('${approver}','${dept}');
    insert into app.leave_balance_calendar_years values(2026),(2027);
    insert into app.leave_balance_holidays values('2026-10-03','개천절'),('2026-10-09','한글날');
    insert into public.my_home_notification_reads values('${staff}','old-event','2026-09-01');
    insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in,clock_out_at) values('${company}','${staff}','2026-10-10','09:00','2026-10-10T18:00+09');
    insert into public.company_leave_requests(company_id,employee_id,kind,status,from_date,to_date,start_time,end_time,offsite_continuous) values('${company}','${staff}','offsite','approved','2026-10-09','2026-10-12','09:00','03:00',true);
    alter table public.profiles enable row level security;create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
    alter table public.attendance_clock_ins enable row level security;create policy own_clock on public.attendance_clock_ins for select to authenticated using(employee_id=auth.uid());
    alter table public.company_leave_requests enable row level security;create policy own_request on public.company_leave_requests for select to authenticated using(employee_id=auth.uid());
    alter table public.my_home_notification_reads enable row level security;create policy own_read on public.my_home_notification_reads for select to authenticated using(reader_id=auth.uid());
    grant select on public.profiles,public.attendance_clock_ins,public.company_leave_requests,public.my_home_notification_reads to authenticated;
    revoke all on function app.save_employee_extra_leave(uuid,uuid,numeric,date,text,integer,boolean) from public,anon,authenticated;
  `)
  const before = await oldSnapshot()
  await db.exec(await readFile('supabase/migrations/20261104081247_holiday_work_settlement.sql', 'utf8'))
  assert.deepEqual(await oldSnapshot(), before, 'migration preserves original rows, reads, policies and table grants')
  assert.equal(Number(await value('select count(*) from app.holiday_work_events')), 0, 'no retrospective notifications')
  assert.equal(Number(await value('select count(*) from app.holiday_work_policy')), 0, 'no invented agreement')
  assert.deepEqual(await value("select app.holiday_work_amount('[{\"start\":540,\"end\":1020}]','rest')"), { minutes:480,night:0,units:1440 })
  assert.deepEqual(await value("select app.holiday_work_amount('[{\"start\":540,\"end\":1140}]','holiday')"), { minutes:600,night:0,units:1920 })
  assert.equal((await value("select app.holiday_work_amount('[{\"start\":0,\"end\":60},{\"start\":1320,\"end\":1440}]','holiday')")).units, 720)
  assert.equal((await value("select app.holiday_work_amount('[{\"start\":540,\"end\":541}]','rest')")).units, 3)
  await assert.rejects(() => value("select app.holiday_work_amount('[{\"start\":540,\"end\":600},{\"start\":599,\"end\":660}]','holiday')"), /중복/)
  await as(staff)
  assert.equal((await list()).rows.length, 3, 'continuous offsite and office clock merge by employee/date')
  assert.equal((await list()).rows.find(r => r.date==='2026-10-10').source.offsites.length, 1)
  await assert.rejects(() => list('operations'), /운영지원/)
  await assert.rejects(() => list('mine','2028-01-01'), /공휴일/)
  await assert.rejects(() => call('submit',{date:'2026-10-12',location:'office',note:'normal',version:0,intervals:[{start:540,end:600}]}), /주말/)
  const submit = async (date,version=0,intervals=[{start:540,end:660}],extra={}) => (await call('submit',{date,location:'office',note:'업무 완료',version,intervals,...extra})).id
  const id = await submit('2026-10-10')
  await assert.rejects(() => submit('2026-10-10'), /이미/)
  await as(ops)
  await assert.rejects(() => call('review',{id,version:1,decision:'approve'}), /승인자/)
  await assert.rejects(() => call('settle',{id:crypto.randomUUID(),ids:[id],versions:{[id]:1},mode:'cash',rate:10000,month:'2026-10-01',note:'확정'}), /확인 상태/)
  await as(peer);assert.equal((await list('review')).rows.length,0);assert.equal((await list()).rows.length,0)
  await assert.rejects(() => call('review',{id,version:1,decision:'approve'}), /승인자/)
  await as(foreign);assert.equal((await list('review')).rows.length,0)
  await assert.rejects(() => call('review',{id,version:1,decision:'approve'}), /승인자/)
  await as(approver)
  assert.equal((await list('review')).rows.find(r=>r.id===id).canReview,true)
  const invitation=(await notices()).find(n=>n.entity_id===id && n.event_type==='holiday-submitted')
  await db.query('select public.read_my_home_work_notification($1)',[invitation.event_key])
  assert.equal((await notices()).find(n=>n.event_key===invitation.event_key).action_needed,true,'read is not approval')
  await assert.rejects(()=>db.query("select public.read_my_home_work_notification('holiday:fake')"),/권한/)
  await call('review',{id,version:1,decision:'return',note:'휴게시간 확인'})
  await as(staff)
  assert.equal((await notices()).find(n=>n.event_type==='holiday-returned').action_needed,true)
  await submit('2026-10-10',2)
  await as(approver)
  assert.equal((await notices()).find(n=>n.event_key===invitation.event_key).current,false,'old report stays historical')
  assert.equal((await notices()).filter(n=>n.event_type==='holiday-submitted' && !n.read_at && n.action_needed).length,1,'new version unread')
  await assert.rejects(()=>call('review',{id,version:1,decision:'approve'}),/상태/)
  await call('review',{id,version:3,decision:'approve',note:'실근무 확인'})
  await as(ops)
  let row=(await list('operations')).rows.find(r=>r.id===id)
  assert.equal(row.actualMinutes,120);assert.equal(row.creditUnits,360)
  const leave={id:crypto.randomUUID(),ids:[id],versions:{[id]:row.version},mode:'leave',days:0.25,expires:'2027-01-31',note:'보상휴가'}
  await assert.rejects(()=>call('settle',leave),/서면합의/)
  await assert.rejects(()=>call('policy',{ref:'아직 미체결',date:'2026-10-01'}),/실제 체결/)
  await call('policy',{ref:'격리 검증용 체결 문서',date:'2026-10-01',confirmed:true})
  await call('settle',leave);await call('settle',leave)
  row=(await list('operations')).rows.find(r=>r.id===id)
  assert.equal(row.remainingUnits,120,'fractional/partial compensation stays in time ledger')
  await db.exec('reset role');assert.equal(Number(await value('select count(*) from app.employee_extra_leave')),1,'idempotent credit');assert.equal(Number(await value('select remaining_leave from app.employee_roster')),7,'annual baseline unchanged')
  await assert.rejects(()=>db.exec('update app.employee_extra_leave set days=1'),/보존/)
  await as(ops)
  const cash={id:crypto.randomUUID(),ids:[id],versions:{[id]:row.version},mode:'cash',rate:10000,month:'2026-10-01',note:'잔여 수당 확정'}
  await call('settle',cash);await call('settle',cash)
  row=(await list('operations')).rows.find(r=>r.id===id)
  assert.equal(row.remainingUnits,0);assert.equal(row.settlements.find(s=>s.mode==='cash').amountWon,10000)
  assert.equal(row.settlements.find(s=>s.mode==='cash').paidOn,null,'cash booking is not payment')
  await assert.rejects(()=>call('paid',{id:cash.id,version:1,date:'2026-10-31'}),/실제 지급/)
  await call('paid',{id:cash.id,version:1,date:'2026-10-31',confirmed:true});await call('paid',{id:cash.id,version:1,date:'2026-10-31',confirmed:true})
  assert.equal((await list('operations')).rows.find(r=>r.id===id).settlements.find(s=>s.mode==='cash').paidOn,'2026-10-31')
  await as(approver)
  assert.equal((await list('review')).rows.find(r=>r.id===id).settlements.find(s=>s.mode==='cash').amountWon,null,'approver has no payroll amount disclosure')
  assert.equal((await list('review')).rows.find(r=>r.id===id).settlements.find(s=>s.mode==='cash').note,'','payroll notes are also private')
  await db.exec('reset role')
  const req=await value('select id from public.company_leave_requests limit 1')
  await assert.rejects(()=>db.query("insert into public.offsite_settlements(request_id,mode,minutes_by_date) values($1,'overtime',$2)",[req,{'2026-10-10':120}]),/주말/)
  await db.query("insert into public.offsite_settlements(request_id,mode,minutes_by_date) values($1,'overtime',$2)",[req,{'2026-10-12':120}])
  await assert.rejects(()=>db.query("insert into public.overtime_actual_reports(request_id,start_at,end_at) values($1,'2026-10-10T22:00+09','2026-10-11T02:00+09')",[req]),/주말/)
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='cancelled' where id=$1",[req]),/원본/)
  // A changed reference cannot silently be approved, and returning/resubmitting
  // creates a new version. Different months may fund one compensation grant.
  await as(staff);const second=await submit('2026-10-11',0,[{start:540,end:621}])
  await db.exec('reset role');await db.query("update public.company_leave_requests set start_time='10:00' where id=$1",[req]).then(()=>assert.fail('approved source must stay protected'),error=>assert.match(error.message,/원본/))
  await db.query("insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values($1,$2,'2026-10-11','10:00')",[company,staff])
  await as(approver);await assert.rejects(()=>call('review',{id:second,version:1,decision:'approve'}),/근거 기록/)
  await call('review',{id:second,version:1,decision:'return',note:'출퇴근 참고 기록이 변경됨'})
  await as(staff);await submit('2026-10-11',2,[{start:540,end:621}])
  await as(approver);await call('review',{id:second,version:3,decision:'approve',note:'확인'})
  await as(staff);const november=await submit('2026-11-01',0,[{start:540,end:620}])
  await as(approver);await call('review',{id:november,version:1,decision:'approve',note:'확인'})
  await as(ops);await call('settle',{id:crypto.randomUUID(),ids:[second,november],versions:{[second]:4,[november]:2},mode:'leave',days:0.5,expires:'2027-01-31',note:'월을 합쳐 반차, 잔여 90초 보관'})
  const octoberLeft=(await list('operations')).rows.find(r=>r.id===second).remainingUnits, novemberLeft=(await list('operations','2026-11-01')).rows.find(r=>r.id===november).remainingUnits
  assert.equal(octoberLeft+novemberLeft,3,'90-second credit stays exact after cross-month pooling')
  await assert.rejects(()=>call('settle',{...cash,note:'동일 정산 번호 다른 입력'}),/정산 번호/)
  await as(approver);const own=await submit('2026-10-17');await assert.rejects(()=>call('review',{id:own,version:1,decision:'approve'}),/승인자/)
  await as(staff);const queue=await submit('2026-10-18')
  await db.exec('reset role');await db.exec('delete from app.test_approvers')
  await as(approver);assert.equal((await list('review')).rows.length,0,'revoked approver cannot retain queue')
  assert.equal((await notices()).some(n=>n.entity_id===queue),false,'revoked approver cannot read notifications')
  await assert.rejects(()=>call('review',{id:queue,version:1,decision:'approve'}),/승인자/)
  await as(staff);assert.equal((await notices()).some(n=>n.event_type==='holiday-paid'),true)
  await assert.rejects(()=>db.exec('select * from app.holiday_work_days'),/permission denied/)
  await assert.rejects(()=>db.exec('delete from public.holiday_work_signals'),/permission denied/)
  await as(peer);assert.equal(Number(await value('select count(*) from public.holiday_work_signals')),0,'signals respect existing department boundaries')
  await db.exec('reset role;set role anon')
  await assert.rejects(()=>call('list',{month:'2026-10-01',scope:'mine'}),/permission denied/)
  await assert.rejects(()=>db.exec('select app.holiday_work_notifications()'),/permission denied/)
  await db.exec('reset role')
  assert.equal(Number(await value('select remaining_leave from app.employee_roster')),7)
  assert.equal(Number(await value("select count(*) from public.my_home_notification_reads where event_key='old-event'")),1)
  console.log('holiday-work isolated DB: migration, permissions, review, versioned notices, agreement lock, partial credit, cash, duplicate guards passed')
} catch (error) { console.error('holiday-work DB verification failed:', error.message, error.code, error.where ?? '', error.position ?? ''); process.exitCode=1 } finally { await db.close() }
