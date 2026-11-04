begin;
-- New ledgers only. Existing requests, clocks, balances and role assignments are not replayed.
create table app.holiday_work_days (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),employee_id uuid not null references public.profiles(id),
 work_date date not null,location text not null check(location in ('office','offsite','mixed')),
 planned_intervals jsonb not null default '[]',reason text not null,intervals jsonb not null default '[]',source_snapshot jsonb not null default '{}',
 state text not null default 'planned' check(state in ('planned','submitted','returned','approved','cancelled')),
 version integer not null default 1,report_version integer not null default 0,
 actual_minutes integer,night_minutes integer,credit_units integer,day_kind text,
 reviewer_id uuid references public.profiles(id),review_note text,submitted_at timestamptz,approved_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,employee_id,work_date)
);
create table app.holiday_work_policy (
 company_id uuid primary key references public.companies(id),agreement_ref text not null,agreement_date date not null,
 actor_id uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp()
);
create table app.holiday_work_settlements (
 id uuid primary key,company_id uuid not null references public.companies(id),employee_id uuid not null references public.profiles(id),
 mode text not null check(mode in ('cash','leave')),units integer not null check(units>0),
 hourly_won numeric(12,2),amount_won bigint,payment_month date,paid_on date,
 leave_days numeric(7,2),expires_on date,grant_id uuid references app.employee_extra_leave(id),agreement_ref text,
 note text not null,request_hash text not null,version integer not null default 1,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 check((mode='cash' and hourly_won>0 and amount_won>0 and payment_month is not null and grant_id is null)
 or(mode='leave' and leave_days>0 and expires_on is not null and grant_id is not null and agreement_ref is not null))
);
create table app.holiday_work_allocations (
 settlement_id uuid not null references app.holiday_work_settlements(id),work_id uuid not null references app.holiday_work_days(id),
 units integer not null check(units>0),primary key(settlement_id,work_id)
);
create table app.holiday_work_events (
 event_key text primary key,work_id uuid not null references app.holiday_work_days(id),kind text not null,
 audience text not null check(audience in ('employee','reviewer','operations')),
 report_version integer not null,settlement_id uuid references app.holiday_work_settlements(id),
 body text not null,created_at timestamptz not null default clock_timestamp()
);
create index holiday_work_days_company_date on app.holiday_work_days(company_id,work_date,employee_id);
create index holiday_work_events_work on app.holiday_work_events(work_id);
create index holiday_work_allocations_work on app.holiday_work_allocations(work_id);
create index holiday_work_days_employee on app.holiday_work_days(employee_id,work_date);
create index holiday_work_days_reviewer on app.holiday_work_days(reviewer_id);
create index holiday_work_policy_actor on app.holiday_work_policy(actor_id);
create index holiday_work_settlements_company on app.holiday_work_settlements(company_id,employee_id);
create index holiday_work_settlements_employee on app.holiday_work_settlements(employee_id);
create index holiday_work_settlements_actor on app.holiday_work_settlements(actor_id);
create index holiday_work_settlements_grant on app.holiday_work_settlements(grant_id);
create index holiday_work_events_settlement on app.holiday_work_events(settlement_id);
create table public.holiday_work_signals (
 employee_id uuid primary key references public.profiles(id),company_id uuid not null references public.companies(id),
 version bigint not null default 1,changed_at timestamptz not null default clock_timestamp()
);
create index holiday_work_signals_company on public.holiday_work_signals(company_id);
alter table app.holiday_work_days enable row level security;
alter table app.holiday_work_policy enable row level security;
alter table app.holiday_work_settlements enable row level security;
alter table app.holiday_work_allocations enable row level security;
alter table app.holiday_work_events enable row level security;
alter table public.holiday_work_signals enable row level security;
revoke all on app.holiday_work_days,app.holiday_work_policy,app.holiday_work_settlements,app.holiday_work_allocations,app.holiday_work_events,public.holiday_work_signals from public,anon,authenticated;

create function app.holiday_work_ops() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and status='active') and (app.can_edit_org_assignment() or app.basic_work_allowed('operations'))
$$;
create function app.holiday_work_review(p_employee uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.profiles me on me.id=auth.uid() and me.status='active' and me.company_id=p.company_id
 where p.id=p_employee and p.id<>me.id and app.is_department_request_approver(p.company_id,p.department_id,'overtime'))
$$;
create function app.holiday_work_can_view(p_employee uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.profiles me on me.id=auth.uid() and me.status='active' and me.company_id=p.company_id
 where p.id=p_employee and (p.id=me.id or app.holiday_work_ops() or app.holiday_work_review(p.id)))
$$;
create policy holiday_work_signal_read on public.holiday_work_signals for select to authenticated using(app.holiday_work_can_view(employee_id));
grant select on public.holiday_work_signals to authenticated;

-- Saturdays follow the company's stated 1.5x policy. Sundays/public holidays use holiday bands.
-- Null means a normal day; unknown holiday-calendar years are never silently classified.
create function app.holiday_work_day_kind(p_date date) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from p_date)::integer) then
 raise exception '해당 연도의 공휴일 기준을 먼저 등록해 주세요.' using errcode='23514'; end if;
 if extract(isodow from p_date)=7 or exists(select 1 from app.leave_balance_holidays where day=p_date) then return 'holiday'; end if;
 if extract(isodow from p_date)=6 then return 'rest'; end if;
 return null;
end $$;


create function app.holiday_work_amount(p_intervals jsonb,p_kind text) returns jsonb language plpgsql immutable set search_path='' as $$
declare item jsonb; lo integer; hi integer; last_end integer:=-1; total integer:=0; night integer:=0;
begin
 if jsonb_typeof(p_intervals) is distinct from 'array' or jsonb_array_length(p_intervals) not between 1 and 24 or p_kind is null or p_kind not in ('rest','holiday') then raise exception '실제 근무 구간을 확인해 주세요.' using errcode='23514'; end if;
 for item in select value from jsonb_array_elements(p_intervals) order by (value->>'start')::integer loop
  if jsonb_typeof(item->'start') is distinct from 'number' or jsonb_typeof(item->'end') is distinct from 'number'
   or (item->>'start')::numeric%1<>0 or (item->>'end')::numeric%1<>0 then raise exception '근무 구간은 분 단위로 입력해 주세요.' using errcode='23514'; end if;
  lo:=(item->>'start')::integer;hi:=(item->>'end')::integer;
  if lo<0 or hi>1440 or hi<=lo or lo<last_end then raise exception '중복되지 않는 실제 근무 구간을 입력해 주세요. 휴게시간은 제외합니다.' using errcode='23514'; end if;
  total:=total+hi-lo;night:=night+greatest(0,least(hi,360)-lo)+greatest(0,hi-greatest(lo,1320));last_end:=hi;
 end loop;
 return jsonb_build_object('minutes',total,'night',night,'units',case p_kind when 'holiday' then least(total,480)*3+greatest(total-480,0)*4 else total*3 end+night);
end $$;

create function app.holiday_work_source(p_employee uuid,p_date date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('offsites',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'from',r.from_date,'to',r.to_date,'start',r.start_time,'end',r.end_time,'next',r.end_next_day,'continuous',r.offsite_continuous) order by r.id)
 from public.company_leave_requests r where r.company_id=(select company_id from public.profiles where id=p_employee) and r.employee_id=p_employee and r.kind='offsite' and r.status='approved'
 and r.from_date<=p_date and r.to_date+case when r.end_next_day then 1 else 0 end>=p_date
 and (not(r.offsite_continuous or r.end_next_day) or (r.to_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0 day' end)>p_date::timestamp)
 and (r.offsite_continuous or r.from_date=r.to_date or (extract(isodow from p_date)<6 and not exists(select 1 from app.leave_balance_holidays where day=p_date)))),'[]'::jsonb),
 'overtimes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'from',r.from_date,'to',r.to_date,'start',r.start_time,'end',r.end_time,'next',r.end_next_day) order by r.id) from public.company_leave_requests r where r.company_id=(select company_id from public.profiles where id=p_employee) and r.employee_id=p_employee and r.kind='overtime' and r.status='approved' and r.from_date<=p_date and r.to_date+case when r.end_next_day then 1 else 0 end>=p_date and (r.to_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0 day' end)>p_date::timestamp),'[]'::jsonb),
 'clocks',coalesce((select jsonb_agg(jsonb_build_object('date',c.work_date,'in',c.clock_in,'out',c.clock_out_at) order by c.work_date)
 from public.attendance_clock_ins c where c.company_id=(select company_id from public.profiles where id=p_employee) and c.employee_id=p_employee and c.work_date<=p_date and (c.work_date=p_date or c.clock_out_at>(p_date::timestamp at time zone 'Asia/Seoul'))),'[]'::jsonb))
$$;
create function app.holiday_work_legacy(p_employee uuid,p_date date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.offsite_settlements s join public.company_leave_requests r on r.id=s.request_id where r.company_id=(select company_id from public.profiles where id=p_employee) and r.employee_id=p_employee and coalesce((s.minutes_by_date->>p_date::text)::integer,0)>0)
 or exists(select 1 from public.overtime_actual_reports a join public.company_leave_requests r on r.id=a.request_id
 where r.company_id=(select company_id from public.profiles where id=p_employee) and r.employee_id=p_employee and r.status='approved' and a.start_at<((p_date+1)::timestamp at time zone 'Asia/Seoul') and a.end_at>(p_date::timestamp at time zone 'Asia/Seoul')
 and extract(epoch from a.end_at-a.start_at)/60>a.break_minutes)
$$;
create function app.holiday_work_signal(p_employee uuid) returns void language sql security definer set search_path='' as $$
 insert into public.holiday_work_signals(employee_id,company_id) select id,company_id from public.profiles where id=p_employee
 on conflict(employee_id) do update set version=public.holiday_work_signals.version+1,changed_at=clock_timestamp()
$$;
create function app.holiday_work_event(p_work uuid,p_kind text,p_audience text,p_body text,p_settlement uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into app.holiday_work_events(event_key,work_id,kind,audience,report_version,settlement_id,body)
 select 'holiday:'||d.id||':'||p_kind||':'||p_audience||':'||d.report_version||':'||coalesce(p_settlement::text,'-'),d.id,p_kind,p_audience,d.report_version,p_settlement,p_body from app.holiday_work_days d where d.id=p_work on conflict do nothing
$$;
create function app.holiday_work_remaining(p_work uuid) returns integer language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce(d.credit_units,0)-coalesce((select sum(a.units)::integer from app.holiday_work_allocations a where a.work_id=d.id),0)) from app.holiday_work_days d where d.id=p_work
$$;

-- Route the whole explicit trip, including a holiday in a different month.
-- Old repeating weekday trips do not imply work on their intervening weekends.
create function app.holiday_work_offsite_holiday(r public.company_leave_requests) returns date language plpgsql stable security definer set search_path='' as $$
declare d date; finish timestamp;
begin
 if r.kind<>'offsite' or (not r.offsite_continuous and r.from_date<>r.to_date) then return null; end if;
 finish:=r.to_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0 day' end;
 for d in select generate_series(r.from_date,least((finish-interval '1 microsecond')::date,r.from_date+7),interval '1 day')::date loop
  if (d+1)::timestamp>r.from_date+r.start_time and d::timestamp<finish and app.holiday_work_day_kind(d) is not null then return d; end if;
 end loop;
 return null;
end $$;

create function app.holiday_work_list(p_month date,p_scope text,p_request uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); last_day date; rows jsonb; policy jsonb; trip public.company_leave_requests;
begin
 if company is null then raise exception '활성 직원만 조회할 수 있습니다.' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_scope not in ('mine','review','operations') then raise exception '조회 월과 범위를 확인하세요.' using errcode='23514'; end if;
 if p_scope='operations' and not app.holiday_work_ops() then raise exception '운영지원 권한이 필요합니다.' using errcode='42501'; end if;
 last_day:=(p_month+interval '1 month - 1 day')::date;
 if p_request is not null then
  select * into trip from public.company_leave_requests where id=p_request and company_id=company and kind='offsite';
  if trip.id is null or not app.holiday_work_can_view(trip.employee_id) then raise exception '해당 외근을 조회할 권한이 없습니다.' using errcode='42501'; end if;
  if app.holiday_work_offsite_holiday(trip) is null then raise exception '주말·공휴일이 포함된 외근을 선택하세요.' using errcode='23514'; end if;
  p_month:=trip.from_date;
  last_day:=((trip.to_date+trip.end_time+case when trip.end_next_day then interval '1 day' else interval '0 day' end)-interval '1 microsecond')::date;
  if exists(select 1 from generate_series(extract(year from p_month)::integer,extract(year from last_day)::integer) y where not exists(select 1 from app.leave_balance_calendar_years c where c.year=y)) then raise exception '외근 전체 기간의 공휴일 기준을 먼저 등록해 주세요.' using errcode='23514'; end if;
 end if;
 if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from p_month)::integer) then raise exception '해당 연도의 공휴일 기준이 없습니다.' using errcode='23514'; end if;
 with dates as (select generate_series(p_month,last_day,interval '1 day')::date as work_day),
 candidates as (
 select p.id employee,d.work_day from public.profiles p cross join dates d where p.company_id=company and (p.status='active' or exists(select 1 from app.holiday_work_days old where old.company_id=company and old.employee_id=p.id and old.work_date=d.work_day))
 and (p_request is null or p.id=trip.employee_id)
 and (p_scope='mine' and p.id=auth.uid() or p_scope='review' and app.holiday_work_review(p.id) or p_scope='operations')
 and (extract(isodow from d.work_day)>5 or exists(select 1 from app.leave_balance_holidays h where h.day=d.work_day))
 and (exists(select 1 from app.holiday_work_days w where w.company_id=company and w.employee_id=p.id and w.work_date=d.work_day)
 or exists(select 1 from public.attendance_clock_ins c where c.company_id=company and c.employee_id=p.id and (c.work_date=d.work_day or (c.work_date<d.work_day and c.clock_out_at>(d.work_day::timestamp at time zone 'Asia/Seoul'))))
 or exists(select 1 from public.company_leave_requests r where r.company_id=company and r.employee_id=p.id and r.status='approved' and r.kind in ('offsite','overtime') and r.from_date<=d.work_day and r.to_date+case when r.end_next_day then 1 else 0 end>=d.work_day and (r.offsite_continuous or r.from_date=r.to_date or r.kind='overtime') and (not(r.offsite_continuous or r.end_next_day) or (r.to_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0 day' end)>d.work_day::timestamp)))
 ) select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'employeeId',p.id,'employeeName',p.display_name,'departmentName',dep.name,'date',c.work_day,
 'dayKind',coalesce(w.day_kind,app.holiday_work_day_kind(c.work_day)),'location',coalesce(w.location,case when jsonb_array_length(source->'offsites')>0 then 'offsite' else 'office' end),
 'plannedIntervals',coalesce(w.planned_intervals,'[]'::jsonb),'state',coalesce(w.state,'unreported'),'version',coalesce(w.version,0),'intervals',coalesce(w.intervals,'[]'),
 'reason',coalesce(w.reason,''),'reviewNote',w.review_note,'actualMinutes',w.actual_minutes,'nightMinutes',w.night_minutes,'creditUnits',w.credit_units,
 'remainingUnits',coalesce(app.holiday_work_remaining(w.id),0),'legacySettled',app.holiday_work_legacy(p.id,c.work_day),'source',source,
 'canSubmit',p.id=auth.uid() and coalesce(w.state,'unreported') in ('unreported','planned','returned','cancelled'),
 'canReview',app.holiday_work_review(p.id) and w.state='submitted','canSettle',app.holiday_work_ops() and w.state='approved',
 'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'mode',s.mode,'units',a.units,'amountWon',case when p.id=auth.uid() or app.holiday_work_ops() then s.amount_won end,'paymentMonth',s.payment_month,'paidOn',s.paid_on,'days',s.leave_days,'expires',s.expires_on,'note',case when p.id=auth.uid() or app.holiday_work_ops() then s.note else '' end) order by s.created_at)
 from app.holiday_work_allocations a join app.holiday_work_settlements s on s.id=a.settlement_id where a.work_id=w.id),'[]'::jsonb)) order by c.work_day desc,p.display_name),'[]'::jsonb) into rows
 from candidates c join public.profiles p on p.id=c.employee left join public.departments dep on dep.id=p.department_id
 left join app.holiday_work_days w on w.company_id=company and w.employee_id=p.id and w.work_date=c.work_day cross join lateral (select app.holiday_work_source(p.id,c.work_day) source) src;
 select jsonb_build_object('ref',agreement_ref,'date',agreement_date) into policy from app.holiday_work_policy where company_id=company;
 return jsonb_build_object('ready',true,'rows',rows,'isOperations',app.holiday_work_ops(),'policy',policy);
end $$;

create function app.holiday_work_day_action(p_action text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare employee uuid:=case when p_action='review' then (select employee_id from app.holiday_work_days where id=(p->>'id')::uuid) else auth.uid() end;
 company uuid:=app.meeting_company_id(); d app.holiday_work_days; date date; source jsonb; amount jsonb; intervals jsonb; day_kind text; note text:=btrim(coalesce(p->>'note',''));
begin
 if company is null or employee is null then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
 if p_action='review' then
  select * into d from app.holiday_work_days where id=(p->>'id')::uuid and company_id=company for update;
  if d.id is null or not app.holiday_work_review(employee) then raise exception '해당 부서 지정 승인자만 확인할 수 있습니다.' using errcode='42501'; end if;
  if d.version is distinct from (p->>'version')::integer or d.state<>'submitted' then raise exception '신청 상태가 변경되었습니다.' using errcode='40001'; end if;
  if p->>'decision'='return' then
   if length(note) not between 1 and 500 then raise exception '보완 요청 사유를 입력하세요.' using errcode='23514'; end if;
   update app.holiday_work_days set state='returned',reviewer_id=auth.uid(),review_note=note,version=version+1,updated_at=clock_timestamp() where id=d.id;
   perform app.holiday_work_event(d.id,'returned','employee',note);
  elsif p->>'decision'='approve' then
   if app.holiday_work_source(employee,d.work_date) is distinct from d.source_snapshot or app.holiday_work_legacy(employee,d.work_date) then raise exception '근거 기록 또는 기존 정산이 변경되었습니다. 보완 요청을 보내 직원이 다시 제출하도록 해 주세요.' using errcode='40001'; end if;
   amount:=app.holiday_work_amount(d.intervals,app.holiday_work_day_kind(d.work_date));
   update app.holiday_work_days set state='approved',reviewer_id=auth.uid(),review_note=note,actual_minutes=(amount->>'minutes')::integer,night_minutes=(amount->>'night')::integer,credit_units=(amount->>'units')::integer,day_kind=app.holiday_work_day_kind(d.work_date),approved_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=d.id;
   perform app.holiday_work_event(d.id,'approved','employee','부서 승인자가 실제 근무시간을 확인했습니다. 보상은 운영지원에서 확정합니다.');
   perform app.holiday_work_event(d.id,'settle','operations','실제 근무시간 확인 완료 · 수당 또는 보상휴가 정산이 필요합니다.');
  else raise exception '확인 또는 보완 요청을 선택하세요.' using errcode='23514'; end if;
 else
  date:=(p->>'date')::date;day_kind:=app.holiday_work_day_kind(date);
  if date is null or day_kind is null then raise exception '주말·공휴일 날짜를 선택하세요.' using errcode='23514'; end if;
  select * into d from app.holiday_work_days where company_id=company and employee_id=employee and work_date=date for update;
  if coalesce(d.version,0) is distinct from (p->>'version')::integer or coalesce(d.state,'unreported') not in ('unreported','planned','returned','cancelled') then raise exception '이미 제출·확인한 기록입니다. 새로 조회하세요.' using errcode='40001'; end if;
  if p_action='cancel' then
   if d.id is null or d.state not in ('planned','returned') then raise exception '취소할 예정 기록이 없습니다.'; end if;
   update app.holiday_work_days set state='cancelled',version=version+1,updated_at=clock_timestamp() where id=d.id;
  else
   if length(note) not between 1 and 500 or p->>'location' is null or p->>'location' not in ('office','offsite','mixed') then raise exception '근무 장소 구분과 사유를 입력하세요.' using errcode='23514'; end if;
   source:=app.holiday_work_source(employee,date);
   if app.holiday_work_legacy(employee,date) then raise exception '이미 외근·야근으로 정산한 날짜입니다. 기존 이력을 먼저 확인하세요.' using errcode='23514'; end if;
   if p_action='submit' then
    intervals:=p->'intervals';amount:=app.holiday_work_amount(intervals,day_kind);
    if date>(now() at time zone 'Asia/Seoul')::date or ((date+make_interval(mins=>(select max((x->>'end')::integer) from jsonb_array_elements(intervals) x))) at time zone 'Asia/Seoul')>clock_timestamp() then raise exception '실제 근무가 종료된 후 제출하세요.' using errcode='23514'; end if;
   else intervals:=p->'intervals';amount:=app.holiday_work_amount(intervals,day_kind); end if;
   insert into app.holiday_work_days(company_id,employee_id,work_date,location,reason,state,intervals,planned_intervals,source_snapshot,report_version,submitted_at)
   values(company,employee,date,p->>'location',note,case when p_action='submit' then 'submitted' else 'planned' end,case when p_action='submit' then intervals else '[]'::jsonb end,case when p_action='plan' then intervals else coalesce(d.planned_intervals,'[]'::jsonb) end,source,case when p_action='submit' then 1 else 0 end,case when p_action='submit' then clock_timestamp() end)
   on conflict(company_id,employee_id,work_date) do update set location=excluded.location,reason=excluded.reason,state=excluded.state,intervals=excluded.intervals,planned_intervals=excluded.planned_intervals,source_snapshot=excluded.source_snapshot,report_version=app.holiday_work_days.report_version+case when p_action='submit' then 1 else 0 end,submitted_at=excluded.submitted_at,version=app.holiday_work_days.version+1,review_note=null,updated_at=clock_timestamp() returning * into d;
   if p_action='submit' then perform app.holiday_work_event(d.id,'submitted','reviewer','실제 근무시간 확인 요청'); end if;
  end if;
 end if;
 perform app.holiday_work_signal(employee);
 return d.id;
end $$;

create function app.holiday_work_settle(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); employee uuid; ids uuid[]; item app.holiday_work_days; previous app.holiday_work_settlements;
 v_id uuid:=(p->>'id')::uuid; mode text:=p->>'mode'; available integer:=0; units integer; left_units integer; take_units integer;
 days numeric; expires date; rate numeric; month date; v_grant uuid; agreement text; note text:=btrim(coalesce(p->>'note',''));
begin
 if not app.holiday_work_ops() or company is null then raise exception '운영지원 보상 확정 권한이 필요합니다.' using errcode='42501'; end if;
 if v_id is null or mode is null or mode not in ('cash','leave') or jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') not between 1 and 100 or length(note) not between 1 and 500 then raise exception '정산할 기록과 처리 사유를 확인하세요.' using errcode='23514'; end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p->'ids');
 select * into previous from app.holiday_work_settlements where holiday_work_settlements.id=v_id;
 if found then
  if previous.company_id=company and previous.request_hash=md5(p::text) then return v_id; end if;
  raise exception '이미 사용한 정산 번호입니다.' using errcode='40001';
 end if;
 select employee_id into employee from app.holiday_work_days where holiday_work_days.id=ids[1] and company_id=company;
 if employee is null then raise exception '정산 대상에 접근할 수 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
 if (select count(*) from app.holiday_work_days d where d.id=any(ids) and d.company_id=company and d.employee_id=employee)<>cardinality(ids) then raise exception '같은 직원의 기록만 함께 정산할 수 있습니다.' using errcode='42501'; end if;
 for item in select * from app.holiday_work_days d where d.id=any(ids) order by d.work_date,d.id for update loop
  if item.state<>'approved' or item.version is distinct from (p->'versions'->>item.id::text)::integer or app.holiday_work_legacy(employee,item.work_date) then raise exception '확인 상태나 기존 정산이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
  if app.holiday_work_remaining(item.id)<=0 then raise exception '이미 전부 정산한 날짜가 포함되어 있습니다. 선택을 해제하고 다시 조회하세요.' using errcode='40001'; end if;
  available:=available+app.holiday_work_remaining(item.id);
 end loop;
 if available<=0 then raise exception '미정산 시간이 없습니다.' using errcode='23514'; end if;
 if mode='leave' then
  select agreement_ref into agreement from app.holiday_work_policy where company_id=company and agreement_date<=(now() at time zone 'Asia/Seoul')::date;
  if agreement is null then raise exception '근로자대표 서면합의 기준 등록 전에는 보상휴가를 확정할 수 없습니다.' using errcode='23514'; end if;
  days:=(p->>'days')::numeric;expires:=(p->>'expires')::date;
  if days is null or days<=0 or days>365 or days*4%1<>0 or expires is null or expires<(now() at time zone 'Asia/Seoul')::date then raise exception '반반차 단위 지급 일수와 사용기한을 확인하세요.' using errcode='23514'; end if;
  units:=(days*960)::integer;
  if units>available then raise exception '선택한 실제 근무의 보상 시간이 부족합니다.' using errcode='23514'; end if;
  v_grant:=app.save_employee_extra_leave(gen_random_uuid(),employee,days,expires,left('휴일근무 보상휴가 · '||note,500),0,false);
 else
  rate:=(p->>'rate')::numeric;month:=(p->>'month')::date;units:=available;
  if rate is null or rate<=0 or rate>10000000 or rate*100%1<>0 or month is null or extract(day from month)<>1 or month<(select date_trunc('month',max(work_date))::date from app.holiday_work_days where holiday_work_days.id=any(ids)) then raise exception '통상시급과 지급 예정 월을 확인하세요.' using errcode='23514'; end if;
 end if;
 insert into app.holiday_work_settlements(id,company_id,employee_id,mode,units,hourly_won,amount_won,payment_month,leave_days,expires_on,grant_id,agreement_ref,note,request_hash,actor_id)
 values(v_id,company,employee,mode,units,rate,case when mode='cash' then ceil(units::numeric*rate/120)::bigint end,month,days,expires,v_grant,agreement,note,md5(p::text),auth.uid());
 left_units:=units;
 for item in select * from app.holiday_work_days d where d.id=any(ids) order by d.work_date,d.id loop
  take_units:=least(left_units,app.holiday_work_remaining(item.id));
  if take_units>0 then
   insert into app.holiday_work_allocations values(v_id,item.id,take_units);
   update app.holiday_work_days set version=version+1,updated_at=clock_timestamp() where holiday_work_days.id=item.id;
   perform app.holiday_work_event(item.id,'settled','employee',case when mode='cash' then '수당 지급 예정으로 확정했습니다. 실제 지급 완료는 별도로 기록합니다.' else '보상휴가를 지급했습니다. 남은 보상 시간은 미정산으로 보존합니다.' end,v_id);
   left_units:=left_units-take_units;
  end if;
 end loop;
 if mode='cash' then perform app.holiday_work_event(ids[1],'payment','operations','확정한 수당의 실제 지급 완료 확인이 필요합니다.',v_id); end if;
 perform app.holiday_work_signal(employee);
 return v_id;
end $$;

create function app.holiday_work_settings(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); s app.holiday_work_settlements; w record; ref text:=btrim(coalesce(p->>'ref','')); date date;
begin
 if company is null or not app.holiday_work_ops() then raise exception '운영지원 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action='policy' then
  date:=(p->>'date')::date;
  if length(ref) not between 1 and 300 or date is null or date>(now() at time zone 'Asia/Seoul')::date or p->>'confirmed' is distinct from 'true' then raise exception '실제 체결한 서면합의의 기준명·체결일과 확인을 입력하세요.' using errcode='23514'; end if;
  insert into app.holiday_work_policy values(company,ref,date,auth.uid(),clock_timestamp()) on conflict(company_id) do update set agreement_ref=excluded.agreement_ref,agreement_date=excluded.agreement_date,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
  return jsonb_build_object('saved',true);
 end if;
 select * into s from app.holiday_work_settlements where id=(p->>'id')::uuid and company_id=company;
 if s.id is null then raise exception '정산 기록에 접근할 수 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.employee_id::text,0));
 select * into s from app.holiday_work_settlements where id=s.id for update;
 date:=(p->>'date')::date;
 if s.paid_on=date then return jsonb_build_object('saved',true); end if;
 if s.mode<>'cash' or s.paid_on is not null or s.version is distinct from (p->>'version')::integer then raise exception '지급 상태가 변경되었습니다.' using errcode='40001'; end if;
 if date is null or date>(now() at time zone 'Asia/Seoul')::date or p->>'confirmed' is distinct from 'true' then raise exception '실제 지급 완료한 날짜와 확인을 입력하세요.' using errcode='23514'; end if;
 update app.holiday_work_settlements set paid_on=date,version=version+1 where id=s.id;
 for w in select work_id from app.holiday_work_allocations where settlement_id=s.id loop perform app.holiday_work_event(w.work_id,'paid','employee','수당 지급 완료가 기록되었습니다.',s.id); end loop;
 perform app.holiday_work_signal(s.employee_id);
 return jsonb_build_object('saved',true);
end $$;

-- Versioned event snapshots, with current approval/operations authority checked at every read.
create function app.holiday_work_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('event_key',e.event_key,'entity_id',d.id,'created_at',e.created_at,'event_type','holiday-'||e.kind,
 'tab',case e.audience when 'reviewer' then 'approvals' when 'operations' then 'holiday-work' else 'my-attendance' end,'kind','overtime',
 'employee_name',p.display_name,'from_date',d.work_date,'to_date',d.work_date,'start_time','','end_time','',
 'note',e.body,'decision_note',case when e.kind in ('settled','paid') then e.body else d.review_note end,
 'title',p.display_name||' · '||d.work_date||' 주말·공휴일 근무 · '||case e.kind when 'submitted' then '실제 시간 확인 요청' when 'returned' then '보완 요청' when 'approved' then '시간 확인 완료' when 'settle' then '보상 정산 대기' when 'payment' then '수당 지급 확인' when 'paid' then '수당 지급 완료' else '보상 확정' end,
 'action_needed',case e.kind when 'submitted' then d.state='submitted' and d.report_version=e.report_version when 'returned' then d.state='returned' and d.report_version=e.report_version when 'settle' then d.state='approved' and app.holiday_work_remaining(d.id)>0 when 'payment' then s.paid_on is null else false end,
 'action_key',case when e.kind='payment' then 'holiday-payment:'||s.id else 'holiday-work:'||d.id end,
 'current',case e.kind when 'submitted' then d.state='submitted' and d.report_version=e.report_version when 'returned' then d.state='returned' and d.report_version=e.report_version when 'settle' then d.state='approved' and app.holiday_work_remaining(d.id)>0 when 'payment' then s.paid_on is null else true end,
 'status',d.state,'read_at',r.read_at)),'[]'::jsonb)
 from app.holiday_work_events e join app.holiday_work_days d on d.id=e.work_id join public.profiles p on p.id=d.employee_id
 left join app.holiday_work_settlements s on s.id=e.settlement_id
 left join public.my_home_notification_reads r on r.reader_id=auth.uid() and r.event_key=e.event_key
 where app.holiday_work_can_view(d.employee_id) and (e.audience='employee' and d.employee_id=auth.uid() or e.audience='reviewer' and app.holiday_work_review(d.employee_id) or e.audience='operations' and app.holiday_work_ops())
$$;

create function app.holiday_work_offsite_settle(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare trip public.company_leave_requests; old_context text:=current_setting('app.holiday_offsite_request',true);
begin
 if not app.holiday_work_ops() then raise exception '운영지원 권한이 필요합니다.' using errcode='42501'; end if;
 select * into trip from public.company_leave_requests where id=(p->>'requestId')::uuid and company_id=app.meeting_company_id() and kind='offsite' and status='approved';
 if trip.id is null then raise exception '해당 외근을 처리할 권한이 없습니다.' using errcode='42501'; end if;
 if app.holiday_work_offsite_holiday(trip) is null then raise exception '주말·공휴일 포함 외근만 이 화면에서 처리합니다.' using errcode='23514'; end if;
 if p->>'mode'='leave' and not exists(select 1 from app.holiday_work_policy where company_id=trip.company_id and agreement_date<=(now() at time zone 'Asia/Seoul')::date) then raise exception '근로자대표 서면합의 기준 등록 전에는 보상휴가를 확정할 수 없습니다.' using errcode='23514'; end if;
 perform set_config('app.holiday_offsite_request',trip.id::text,true);
 perform app.save_offsite_settlement(trip.id,p->>'mode',p->'minutes',(p->>'days')::numeric,(p->>'expires')::date,p->>'note');
 perform set_config('app.holiday_offsite_request',coalesce(old_context,''),true);
 perform app.holiday_work_signal(trip.employee_id);
 return jsonb_build_object('saved',true);
exception when others then
 perform set_config('app.holiday_offsite_request',coalesce(old_context,''),true);raise;
end $$;

create function app.holiday_work(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if app.meeting_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
 if p_action='list' then return app.holiday_work_list((p->>'month')::date,p->>'scope',(p->>'request')::uuid);
 elsif p_action in ('plan','submit','review','cancel') then return jsonb_build_object('id',app.holiday_work_day_action(p_action,p));
 elsif p_action='settle' then return jsonb_build_object('id',app.holiday_work_settle(p));
 elsif p_action in ('policy','paid') then return app.holiday_work_settings(p_action,p);
 elsif p_action='offsite-settle' then return app.holiday_work_offsite_settle(p);
 else raise exception '지원하지 않는 처리입니다.' using errcode='23514'; end if;
end $$;
create function public.holiday_work(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select app.holiday_work(p_action,p_payload) $$;

-- The old notification source stays invoker; new entries use the same per-recipient read table.
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.list_my_home_work_notifications()'::regprocedure);
 execute replace(definition,'FUNCTION public.list_my_home_work_notifications(','FUNCTION app.list_my_home_work_notifications_before_holiday(');
end $$;
create or replace function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
 select app.list_my_home_work_notifications_before_holiday()||app.holiday_work_notifications()
$$;

-- Old clients cannot pay/credit holiday hours through weekday workflows. No old row is modified.
create function app.guard_holiday_work_duplicate() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.company_leave_requests; d date;
begin
 if TG_TABLE_NAME='offsite_settlements' then
  select * into r from public.company_leave_requests where id=new.request_id;
  perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text,0));
  if app.holiday_work_offsite_holiday(r) is not null and current_setting('app.holiday_offsite_request',true) is distinct from r.id::text then raise exception '주말·공휴일이 포함된 외근은 건 전체를 주말·공휴일 근무 관리에서 후처리해 주세요.' using errcode='23514'; end if;
  if exists(select 1 from jsonb_each_text(new.minutes_by_date) x where x.value::integer>0 and (extract(isodow from x.key::date)>5 or exists(select 1 from app.leave_balance_holidays h where h.day=x.key::date))) then raise exception '주말·공휴일 구간은 주말·공휴일 근무 관리에서 확인·정산해 주세요.' using errcode='23514'; end if;
 elsif TG_TABLE_NAME='overtime_actual_reports' then
  select * into r from public.company_leave_requests where id=new.request_id;
  perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text,0));
  for d in select generate_series((new.start_at at time zone 'Asia/Seoul')::date,((new.end_at-interval '1 microsecond') at time zone 'Asia/Seoul')::date,interval '1 day')::date loop
   if extract(isodow from d)>5 or exists(select 1 from app.leave_balance_holidays where day=d) then raise exception '주말·공휴일 실제 근무는 주말·공휴일 근무 관리에서 제출하세요. 평일 구간과 나눠 입력해 주세요.' using errcode='23514'; end if;
  end loop;
 elsif TG_TABLE_NAME='employee_extra_leave' then
  if exists(select 1 from app.holiday_work_settlements where grant_id=old.id) and row(new.days,new.expires_on,new.deleted_at,new.note) is distinct from row(old.days,old.expires_on,old.deleted_at,old.note) then raise exception '휴일근무 보상휴가 원본은 정산 이력과 함께 보존합니다.' using errcode='23514'; end if;
 elsif TG_TABLE_NAME='company_leave_requests' then
  if exists(select 1 from app.holiday_work_days h where h.employee_id=old.employee_id and h.state='approved' and exists(select 1 from jsonb_array_elements(coalesce(h.source_snapshot->'offsites','[]'::jsonb)||coalesce(h.source_snapshot->'overtimes','[]'::jsonb)) x where x->>'id'=old.id::text))
   and row(new.status,new.from_date,new.to_date,new.start_time,new.end_time,new.end_next_day,new.offsite_continuous,new.employee_id) is distinct from row(old.status,old.from_date,old.to_date,old.start_time,old.end_time,old.end_next_day,old.offsite_continuous,old.employee_id) then raise exception '실제 시간 확인된 휴일근무의 외근 원본입니다. 정산 이력을 먼저 확인해 주세요.' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger zz_holiday_offsite_duplicate before insert on public.offsite_settlements for each row execute function app.guard_holiday_work_duplicate();
create trigger zz_holiday_overtime_duplicate before insert on public.overtime_actual_reports for each row execute function app.guard_holiday_work_duplicate();
create trigger zz_holiday_extra_leave_guard before update on app.employee_extra_leave for each row execute function app.guard_holiday_work_duplicate();
create trigger zz_holiday_source_guard before update on public.company_leave_requests for each row execute function app.guard_holiday_work_duplicate();

do $$declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='app' and (p.proname like 'holiday_work%' or p.proname in ('guard_holiday_work_duplicate','list_my_home_work_notifications_before_holiday'))) or (n.nspname='public' and p.proname='holiday_work') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname in ('holiday_work','holiday_work_can_view','holiday_work_notifications','list_my_home_work_notifications_before_holiday') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.holiday_work_signals; end if;
end $$;
create table app.holiday_work_day_history(id bigint generated always as identity primary key,work_id uuid not null references app.holiday_work_days(id),version integer not null,actor_id uuid references public.profiles(id),snapshot jsonb not null,created_at timestamptz not null default clock_timestamp());
create index holiday_work_history_work on app.holiday_work_day_history(work_id);
create index holiday_work_history_actor on app.holiday_work_day_history(actor_id);
alter table app.holiday_work_day_history enable row level security;
revoke all on app.holiday_work_day_history from public,anon,authenticated;
create function app.holiday_work_audit() returns trigger language plpgsql security definer set search_path='' as $$begin insert into app.holiday_work_day_history(work_id,version,actor_id,snapshot) values(new.id,new.version,auth.uid(),to_jsonb(new));return new;end$$;
revoke all on function app.holiday_work_audit() from public,anon,authenticated;
create trigger holiday_work_day_audit after insert or update on app.holiday_work_days for each row execute function app.holiday_work_audit();
notify pgrst,'reload schema';
commit;
