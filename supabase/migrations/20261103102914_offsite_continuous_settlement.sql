-- Additive; prepare locally first. Requires the existing offsite_workday_start migration.
begin;
alter table public.company_leave_requests add column offsite_continuous boolean not null default false;
alter table public.company_leave_requests drop constraint company_leave_requests_span_check;
alter table public.company_leave_requests add constraint company_leave_requests_span_check check (
 (offsite_continuous and kind='offsite' and not end_next_day and to_date+end_time>from_date+start_time) or
 (not offsite_continuous and (
  (kind in ('annual','official') and not end_next_day) or
  (kind='offsite' and from_date=to_date and end_next_day and end_time<=start_time) or
  (kind in ('overtime','correction') and from_date=to_date and ((end_next_day and end_time<=start_time) or (not end_next_day and end_time>start_time))) or
  (kind not in ('annual','official','overtime','correction') and not end_next_day and end_time>start_time and (from_date=to_date or kind in ('offsite','remote')))
 ))
);
alter table public.company_leave_requests drop constraint company_leave_offsite_work_start_check;
alter table public.company_leave_requests add constraint company_leave_offsite_work_start_check check (
 offsite_work_start is null or (kind='offsite' and (from_date=to_date or offsite_continuous)
 and offsite_work_start<time '24:00' and extract(second from offsite_work_start)=0));

create function app.offsite_finish(r public.company_leave_requests,d date) returns timestamptz
language sql immutable set search_path='' as $$
 select ((case when r.offsite_continuous then r.to_date else d+case when r.end_next_day then 1 else 0 end end)+r.end_time) at time zone 'Asia/Seoul';
$$;
revoke all on function app.offsite_finish(public.company_leave_requests,date) from public,anon,authenticated;

-- Patch only the explicit time expressions in the installed functions. Fail on drift;
-- retain original ACLs, owners, lock timeouts, approval checks and unrelated logic.
do $patch$
declare name text; signature regprocedure; original text; changed text; d text;
begin
 foreach name in array array['advance_offsite_attendance','offsite_attendance_state','process_attendance_presence','attendance_presence_end'] loop
  signature:=case name when 'advance_offsite_attendance' then 'app.advance_offsite_attendance(uuid,date,timestamp with time zone)'::regprocedure
    when 'offsite_attendance_state' then 'app.offsite_attendance_state(boolean)'::regprocedure
    when 'process_attendance_presence' then 'app.process_attendance_presence()'::regprocedure
    else 'app.attendance_presence_end(uuid)'::regprocedure end;
  original:=pg_get_functiondef(signature); changed:=original;
  foreach d in array array['p_date','work_day','days.day::date','d.work_date'] loop
   changed:=replace(changed,'(('||d||'+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone ''Asia/Seoul''','app.offsite_finish(r,'||d||')');
   changed:=replace(changed,'('||d||'+r.end_time+case when r.end_next_day then interval ''1 day'' else interval ''0'' end)','(app.offsite_finish(r,'||d||') at time zone ''Asia/Seoul'')');
  end loop;
  changed:=replace(changed,'r.from_date<=p_date and r.to_date>=p_date','r.from_date<=p_date and r.to_date>=p_date and (not r.offsite_continuous or r.from_date=p_date)');
  changed:=replace(changed,'r.from_date<=work_day and r.to_date>=work_day','r.from_date<=work_day and r.to_date>=work_day and (not r.offsite_continuous or r.from_date=work_day)');
  changed:=replace(changed,'r.from_date=r.to_date or','r.offsite_continuous or r.from_date=r.to_date or');
  if name='process_attendance_presence' then
   changed:=replace(changed,'least(r.to_date,today)','least(case when r.offsite_continuous then r.from_date else r.to_date end,today)');
  elsif name='offsite_attendance_state' then
   changed:=replace(changed,'state text;','state text; prior_day record;');
   changed:=replace(changed,'perform app.advance_offsite_attendance(actor,today-1,stamp);',
    'for prior_day in select distinct r.from_date from public.company_leave_requests r where r.employee_id=actor and r.company_id=company and r.kind=''offsite'' and r.status=''approved'' and r.offsite_continuous and r.from_date<today and exists(select 1 from public.attendance_clock_ins ongoing_clock where ongoing_clock.employee_id=actor and ongoing_clock.work_date=r.from_date and ongoing_clock.clock_out_at is null and ongoing_clock.auto_closed_at is null) loop perform app.advance_offsite_attendance(actor,prior_day.from_date,stamp); end loop; perform app.advance_offsite_attendance(actor,today-1,stamp);');
   changed:=replace(changed,'work_day:=today;',
    'work_day:=coalesce((select r.from_date from public.company_leave_requests r join public.attendance_clock_ins ongoing_clock on ongoing_clock.employee_id=r.employee_id and ongoing_clock.work_date=r.from_date where r.employee_id=actor and r.company_id=company and r.kind=''offsite'' and r.status=''approved'' and r.offsite_continuous and r.from_date<today and not exists(select 1 from public.attendance_clock_ins t where t.employee_id=actor and t.work_date=today) and ((ongoing_clock.clock_out_at is null and ongoing_clock.auto_closed_at is null) or (ongoing_clock.clock_out_source=''offsite'' and r.to_date>=today)) order by r.from_date desc limit 1),today);');
   changed:=replace(changed,'''overnightSupported'',true','''continuousSupported'',true,''overnightSupported'',true');
  end if;
  if changed=original then raise exception '외근 함수 변경 지점을 찾지 못했습니다: %',name; end if;
  execute changed;
 end loop;
 original:=pg_get_functiondef('app.clock_in_today()'::regprocedure);
 changed:=replace(original,'perform app.advance_offsite_attendance(actor,today-1,clock_timestamp());',
  'perform app.offsite_attendance_state(false); perform app.advance_offsite_attendance(actor,today-1,clock_timestamp());
   if exists(select 1 from public.company_leave_requests r join public.attendance_clock_ins c on c.employee_id=r.employee_id and c.work_date=r.from_date where r.employee_id=actor and r.kind=''offsite'' and r.status=''approved'' and r.offsite_continuous and r.from_date<today and c.clock_out_at is null and c.auto_closed_at is null) then raise exception ''이전에 시작한 외근이 근무 중입니다. 기존 근무의 퇴근을 먼저 기록해 주세요.''; end if;');
 if changed=original then raise exception '출근 함수 변경 지점 확인 필요'; end if; execute changed;
 original:=pg_get_functiondef('app.clock_out_today()'::regprocedure);
 changed:=replace(original,'c.work_date=today-1','c.work_date<today');
 changed:=replace(changed,'r.end_next_day and r.from_date=c.work_date and r.to_date=c.work_date',
   '(r.offsite_continuous or (r.end_next_day and r.to_date=c.work_date and c.work_date=today-1)) and r.from_date=c.work_date');
 changed:=replace(changed,'for update;','order by c.work_date desc limit 1 for update;');
 -- Only the fallback SELECT uses alias c.
 changed:=replace(changed,'work_date = today order by c.work_date desc limit 1 for update;','work_date = today for update;');
 if changed=original then raise exception '퇴근 함수 변경 지점 확인 필요'; end if; execute changed;
 original:=pg_get_functiondef('app.guard_offsite_workday_start()'::regprocedure);
 changed:=replace(original,'new.from_date<>new.to_date','(new.from_date<>new.to_date and not new.offsite_continuous)');
 changed:=replace(changed,'r.to_date=new.from_date','(r.to_date=new.from_date or r.offsite_continuous)');
 if changed=original then raise exception '출근 기준 함수 변경 지점 확인 필요'; end if; execute changed;
 original:=pg_get_functiondef('app.attendance_start_for_date(uuid,date)'::regprocedure);
 changed:=replace(original,'r.to_date=p_date','(r.to_date=p_date or r.offsite_continuous)');
 if changed=original then raise exception '출근 기준 조회 변경 지점 확인 필요'; end if; execute changed;
end $patch$;

create table public.offsite_settlements (
 request_id uuid primary key references public.company_leave_requests(id),
 mode text not null check(mode in ('overtime','leave','none')),
 minutes_by_date jsonb not null check(jsonb_typeof(minutes_by_date)='object'),
 leave_days numeric, expires_on date, grant_id uuid unique,
 note text not null check(length(btrim(note)) between 1 and 500),
 decided_by uuid not null references public.profiles(id),
 decided_at timestamptz not null default clock_timestamp(),
 check((mode='leave' and leave_days>0 and mod(leave_days,0.25)=0 and expires_on is not null and grant_id is not null)
   or (mode<>'leave' and leave_days is null and expires_on is null and grant_id is null))
);
alter table public.offsite_settlements enable row level security;
revoke all on public.offsite_settlements from public,anon,authenticated;
grant select on public.offsite_settlements to authenticated;
create policy offsite_settlement_read on public.offsite_settlements for select to authenticated using (
 exists(select 1 from public.company_leave_requests r where r.id=request_id)
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active')
);

-- Expected extra minutes only: never credit the whole trip or infer actual work from clock-out.
create function app.offsite_extra_minutes(r public.company_leave_requests,d date) returns integer
language plpgsql stable security definer set search_path='' as $$
declare lo timestamptz; hi timestamptz; base time; a timestamptz; b timestamptz; ls time; le time;
  l timestamptz; u timestamptz; normal tstzmultirange; extra tstzmultirange; span record; total integer:=0;
begin
 if r.kind<>'offsite' or r.status<>'approved' or d<r.from_date or d>(r.to_date+case when r.end_next_day then 1 else 0 end) then return 0; end if;
 if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from d)::integer) then return null; end if;
 if not r.offsite_continuous and r.from_date<>r.to_date and (extract(isodow from d)>5 or exists(select 1 from app.leave_balance_holidays h where h.day=d)) then return 0; end if;
 lo:=greatest((d+time '00:00') at time zone 'Asia/Seoul',((case when r.offsite_continuous or r.end_next_day then r.from_date else d end)+r.start_time) at time zone 'Asia/Seoul');
 hi:=least(((d+1)+time '00:00') at time zone 'Asia/Seoul',app.offsite_finish(r,case when r.end_next_day then r.from_date else d end));
 if hi<=lo then return 0; end if;
 select coalesce(h.lunch_start,time '12:00'),coalesce(h.lunch_end,time '13:00') into ls,le from public.company_work_hours h where h.company_id=r.company_id;
 ls:=coalesce(ls,time '12:00'); le:=coalesce(le,time '13:00');
 l:=(d+ls) at time zone 'Asia/Seoul'; u:=(d+le) at time zone 'Asia/Seoul';
 if u<l then return null; end if;
 extra:=tstzmultirange(tstzrange(lo,hi,'[)'))-tstzmultirange(tstzrange(l,u,'[)'));
 if extract(isodow from d)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=d) then
  base:=app.attendance_start_for_date(r.employee_id,d); if base is null then return null; end if;
  a:=(d+base) at time zone 'Asia/Seoul'; b:=a+interval '8 hours';
  if a<u and b>l then b:=b+(u-greatest(a,l)); end if;
  normal:=tstzmultirange(tstzrange(a,b,'[)'))-tstzmultirange(tstzrange(l,u,'[)'));
  for span in select * from public.company_leave_requests x where x.employee_id=r.employee_id and x.company_id=r.company_id and x.status='approved' and x.from_date<=d and x.to_date>=d and x.kind in ('annual','official','half','quarter') loop
   if span.kind in ('annual','official') then normal:='{}'::tstzmultirange;
   else normal:=normal-tstzmultirange(tstzrange((d+span.start_time) at time zone 'Asia/Seoul',(d+span.end_time) at time zone 'Asia/Seoul','[)')); end if;
  end loop;
  extra:=extra-normal;
 end if;
 for span in select unnest(extra) as period loop total:=total+floor(extract(epoch from upper(span.period)-lower(span.period))/60)::integer; end loop;
 return total;
end $$;
revoke all on function app.offsite_extra_minutes(public.company_leave_requests,date) from public,anon,authenticated;

create function app.save_offsite_settlement(p_request uuid,p_mode text,p_minutes jsonb,p_days numeric,p_expires date,p_note text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare r public.company_leave_requests%rowtype; actor public.profiles%rowtype; item record; d date; allowed integer; total integer:=0; compensation_grant uuid; existing public.offsite_settlements%rowtype;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active';
 if actor.id is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '운영지원 근태 관리 권한이 필요합니다.' using errcode='42501'; end if;
 select * into r from public.company_leave_requests where id=p_request;
 if not found or r.company_id<>actor.company_id or r.kind<>'offsite' or r.status<>'approved' then raise exception '처리할 외근을 확인해 주세요.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text,0));
 select * into r from public.company_leave_requests where id=p_request for update;
 if r.status<>'approved' then raise exception '외근 상태가 변경됐습니다.' using errcode='40001'; end if;
 select * into existing from public.offsite_settlements where request_id=p_request;
 if found then
  if row(existing.mode,existing.minutes_by_date,existing.leave_days,existing.expires_on,existing.note) is not distinct from row(p_mode,p_minutes,p_days,p_expires,btrim(p_note)) then return; end if;
  raise exception '이미 후처리한 외근입니다. 다시 조회해 주세요.' using errcode='40001';
 end if;
 if app.offsite_finish(r,r.to_date)>clock_timestamp() then raise exception '종료된 외근만 후처리할 수 있습니다.'; end if;
 if p_mode is null or p_mode not in ('overtime','leave','none') or p_minutes is null or jsonb_typeof(p_minutes)<>'object' or p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception '후처리 입력을 확인해 주세요.'; end if;
 for item in select key,value from jsonb_each_text(p_minutes) loop
  if item.key !~ '^\d{4}-\d{2}-\d{2}$' or item.value !~ '^\d{1,4}$' then raise exception '날짜별 실제 추가 근무분을 정수 분으로 입력해 주세요.'; end if;
  d:=item.key::date;
  allowed:=app.offsite_extra_minutes(r,d);
  if allowed is null then raise exception '% 근무·공휴일 기준을 먼저 확인해 주세요.',d; end if;
  if item.value::integer>allowed then raise exception '% 실제 추가 근무분이 외근의 추가 근무 가능 시간을 넘습니다.',d; end if;
  total:=total+item.value::integer;
 end loop;
 if (p_mode='none' and total<>0) or (p_mode<>'none' and total<=0) then raise exception '실제 추가 근무시간과 처리 방식을 확인해 주세요.'; end if;
 if exists(select 1 from public.company_leave_requests ot join public.overtime_actual_latest a on a.request_id=ot.id
   where ot.employee_id=r.employee_id and ot.status='approved' and tstzrange(a.start_at,a.end_at,'[)') && tstzrange((r.from_date+r.start_time) at time zone 'Asia/Seoul',app.offsite_finish(r,r.to_date),'[)')) then
  raise exception '겹치는 별도 야근 실제 기록이 있습니다. 중복 보상을 막기 위해 해당 기록을 먼저 확인해 주세요.';
 end if;
 if p_mode='leave' then
  if p_days is null or p_days<=0 or p_days>365 or mod(p_days,0.25)<>0 or p_expires is null or p_expires<(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '추가 휴가 일수(.25일 단위)와 사용기한을 확인해 주세요.'; end if;
  compensation_grant:=gen_random_uuid();
  perform app.save_employee_extra_leave(compensation_grant,r.employee_id,p_days,p_expires,'외근 보상 · '||r.from_date||' · '||left(btrim(p_note),450),0,false);
 elsif p_days is not null or p_expires is not null then raise exception '휴가 지급에만 일수·기한을 지정할 수 있습니다.'; end if;
 insert into public.offsite_settlements(request_id,mode,minutes_by_date,leave_days,expires_on,grant_id,note,decided_by)
 values(p_request,p_mode,p_minutes,p_days,p_expires,compensation_grant,btrim(p_note),actor.id);
end $$;
revoke all on function app.save_offsite_settlement(uuid,text,jsonb,numeric,date,text) from public,anon,authenticated;
create function public.save_offsite_settlement(p_request uuid,p_mode text,p_minutes jsonb,p_days numeric,p_expires date,p_note text) returns void
language sql security invoker set search_path='' as $$ select app.save_offsite_settlement(p_request,p_mode,p_minutes,p_days,p_expires,p_note); $$;
grant execute on function app.save_offsite_settlement(uuid,text,jsonb,numeric,date,text) to authenticated;
revoke all on function public.save_offsite_settlement(uuid,text,jsonb,numeric,date,text) from public,anon;
grant execute on function public.save_offsite_settlement(uuid,text,jsonb,numeric,date,text) to authenticated;

create function app.guard_offsite_settlement_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.offsite_continuous is distinct from old.offsite_continuous then raise exception '외근 원본 형식은 변경할 수 없습니다.'; end if;
  if new.status is distinct from old.status and exists(select 1 from public.offsite_settlements s where s.request_id=new.id) then raise exception '보상 처리된 외근은 취소할 수 없습니다. 운영지원에 문의해 주세요.'; end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_offsite_settlement_source() from public,anon,authenticated;
create trigger zz_offsite_settlement_source before insert or update on public.company_leave_requests for each row execute function app.guard_offsite_settlement_source();

create function app.guard_overtime_offsite_duplicate() returns trigger language plpgsql security definer set search_path='' as $$
declare employee uuid;
begin
 select employee_id into employee from public.company_leave_requests where id=new.request_id;
 perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
 if exists(select 1 from public.offsite_settlements s join public.company_leave_requests r on r.id=s.request_id where r.employee_id=employee
  and tstzrange(new.start_at,new.end_at,'[)') && tstzrange((r.from_date+r.start_time) at time zone 'Asia/Seoul',app.offsite_finish(r,r.to_date),'[)')) then
  raise exception '이미 후처리한 외근과 겹칩니다. 야근을 중복 누적할 수 없습니다.';
 end if; return new;
end $$;
revoke all on function app.guard_overtime_offsite_duplicate() from public,anon,authenticated;
create trigger zz_overtime_offsite_duplicate before insert on public.overtime_actual_reports for each row execute function app.guard_overtime_offsite_duplicate();
create function app.offsite_settlement_preview(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.company_leave_requests%rowtype;
begin
 select * into r from public.company_leave_requests where id=p_request;
 if not found or r.kind<>'offsite' or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id=r.company_id)
  or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '운영지원 근태 관리 권한이 필요합니다.' using errcode='42501'; end if;
 return jsonb_build_object('serverNow',clock_timestamp(),'settlement',(select to_jsonb(s) from public.offsite_settlements s where request_id=p_request),
  'dates',(select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'minutes',app.offsite_extra_minutes(r,d::date)) order by d),'[]'::jsonb) from generate_series(r.from_date,r.to_date+case when r.end_next_day then 1 else 0 end,interval '1 day') d));
end $$;
-- Canonical row and existing management checks above; no caller-provided employee/times.
revoke all on function app.offsite_settlement_preview(uuid) from public,anon;
grant execute on function app.offsite_settlement_preview(uuid) to authenticated;
create function public.offsite_settlement_preview(p_request uuid) returns jsonb language sql security invoker set search_path='' as $$ select app.offsite_settlement_preview(p_request); $$;
revoke all on function public.offsite_settlement_preview(uuid) from public,anon;
grant execute on function public.offsite_settlement_preview(uuid) to authenticated;

-- Protect the linkage: manual extra-leave editing cannot silently detach settled compensation.
create function app.guard_offsite_compensation_grant() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.offsite_settlements s where s.grant_id=old.id) and
  row(new.days,new.expires_on,new.note,new.deleted_at) is distinct from row(old.days,old.expires_on,old.note,old.deleted_at) then
  raise exception '외근 후처리로 지급한 휴가는 보상 이력과 연결되어 있어 직접 수정·삭제할 수 없습니다.';
 end if; return new;
end $$;
revoke all on function app.guard_offsite_compensation_grant() from public,anon,authenticated;
create trigger offsite_compensation_grant before update on app.employee_extra_leave for each row execute function app.guard_offsite_compensation_grant();

-- Same inbox/read records and detail route; no historical result backfill.
do $$ declare source text; begin
 source:=pg_get_functiondef('public.list_my_home_work_notifications()'::regprocedure);
 source:=replace(source,'public.list_my_home_work_notifications()','app.list_my_home_work_notifications_before_offsite()');
 execute source;
end $$;
revoke all on function app.list_my_home_work_notifications_before_offsite() from public,anon;
grant execute on function app.list_my_home_work_notifications_before_offsite() to authenticated;
create or replace function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce((select jsonb_agg(n) from jsonb_array_elements(app.list_my_home_work_notifications_before_offsite()) n
  where not(n->>'event_type'='checkout' and exists(select 1 from public.company_leave_requests r where r.employee_id=auth.uid() and r.kind='offsite' and r.status='approved' and r.offsite_continuous and r.from_date::text=n->>'entity_id' and (r.to_date+r.end_time) at time zone 'Asia/Seoul'>now()))),'[]'::jsonb)
 ||coalesce((select jsonb_agg(jsonb_build_object('event_key','offsite-settlement:'||s.request_id,'entity_id',r.id,'created_at',s.decided_at,
  'event_type','offsite-settlement','tab','my-attendance','kind','offsite','employee_name',r.employee_name,'from_date',r.from_date,'to_date',r.to_date,
  'start_time',r.start_time,'end_time',r.end_time,'note',s.note,'decision_note',case s.mode when 'leave' then '추가 휴가 '||s.leave_days||'일 · '||s.expires_on||'까지 · 야근 누적 제외' when 'overtime' then '확인된 실제 추가 근무를 날짜별 야근 누적에 반영했습니다.' else '실제 추가 근무 없음으로 확인했습니다.' end,
  'action_needed',false,'status',r.status,'current',true,'read_at',h.read_at))
  from public.offsite_settlements s join public.company_leave_requests r on r.id=s.request_id
  left join public.my_home_notification_reads h on h.reader_id=auth.uid() and h.event_key='offsite-settlement:'||s.request_id
  where r.employee_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active')),'[]'::jsonb);
$$;
notify pgrst,'reload schema';
commit;
