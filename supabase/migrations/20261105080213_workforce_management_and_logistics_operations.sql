-- Additive management scopes and a separate manual logistics ledger.
-- No profile, permission grant, attendance clock, leave request or balance is rewritten.
create table public.workforce_management_overrides (
  employee_id uuid primary key references public.profiles(id),
  company_id uuid not null references public.companies(id),
  mode text not null check(mode in ('head-office','logistics','external')),
  tracking_start date,
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  check((mode='head-office' and tracking_start is not null and tracking_start>='2026-11-02') or (mode<>'head-office' and tracking_start is null))
);
create index workforce_management_company on public.workforce_management_overrides(company_id,employee_id);
create table app.workforce_management_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id), employee_id uuid not null references public.profiles(id),
  actor_id uuid not null references public.profiles(id), before_value jsonb, after_value jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on app.workforce_management_events from public,anon,authenticated;
alter table public.workforce_management_overrides enable row level security;
revoke all on public.workforce_management_overrides from public,anon,authenticated;
grant select on public.workforce_management_overrides to authenticated;
create policy workforce_management_read on public.workforce_management_overrides for select to authenticated
  using(company_id=(select app.permission_company_id()));

create function app.workforce_mode(p_employee uuid) returns text language sql stable security definer set search_path='' as $$
  select coalesce(o.mode,case
    when p.company_id='e0000000-0000-4000-8000-000000000001' and p.department_id='bf926822-910c-422f-9c17-5fd3d8ddb3ba' then 'external'
    when p.company_id='e0000000-0000-4000-8000-000000000001' and p.department_id='c5d4cfca-97ce-4ca7-b30a-6beed842cf1e' then 'logistics'
    else 'head-office' end)
  from public.profiles p left join public.workforce_management_overrides o on o.employee_id=p.id and o.company_id=p.company_id where p.id=p_employee;
$$;
create function app.logistics_operations_manager() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
    and p.company_id='e0000000-0000-4000-8000-000000000001' and p.id='7f159ac7-9e05-41a4-8891-f9929d3af806');
$$;
revoke all on function app.workforce_mode(uuid),app.logistics_operations_manager() from public,anon,authenticated;
grant execute on function app.logistics_operations_manager() to authenticated;

create function app.list_workforce_management() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id();
begin
  if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('employeeId',p.id,'mode',app.workforce_mode(p.id),
    'trackingStart',o.tracking_start,'version',coalesce(o.version,0)) order by p.id),'[]'::jsonb)
    from public.profiles p left join public.workforce_management_overrides o on o.employee_id=p.id and o.company_id=company
    where p.company_id=company and p.status='active');
end $$;
create function app.save_workforce_management(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=app.permission_company_id(); target public.profiles%rowtype; previous public.workforce_management_overrides%rowtype;
  employee uuid:=(p_input->>'employeeId')::uuid; mode text:=p_input->>'mode'; starts date:=(p_input->>'trackingStart')::date;
  expected integer:=(p_input->>'version')::integer; previous_mode text; result jsonb; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if company is null or not app.can_edit_org_assignment() then raise exception '조직 관리 권한이 필요합니다.' using errcode='42501'; end if;
  if employee is null or mode is null or mode not in ('head-office','logistics','external') or expected is null or expected<0 then raise exception '직원과 관리 방식을 확인해 주세요.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workforce:'||employee::text,0));
  select * into target from public.profiles where id=employee and company_id=company and status='active' for share;
  if not found then raise exception '같은 회사의 재직 직원만 설정할 수 있습니다.' using errcode='42501'; end if;
  select * into previous from public.workforce_management_overrides where employee_id=employee;
  if coalesce(previous.version,0)<>expected then raise exception '관리 방식이 변경됐습니다. 새로 조회해 주세요.' using errcode='40001'; end if;
  previous_mode:=app.workforce_mode(employee);
  if mode='head-office' then
    if starts is null or starts<'2026-11-02' or (previous_mode<>'head-office' and starts<today) then raise exception '본사 관리 전환은 오늘 이후의 근태 시작일을 지정해 주세요.' using errcode='22023'; end if;
  else starts:=null; end if;
  if previous.mode=mode and previous.tracking_start is not distinct from starts then
    return jsonb_build_object('employeeId',employee,'mode',mode,'trackingStart',starts,'version',previous.version);
  end if;
  insert into public.workforce_management_overrides(employee_id,company_id,mode,tracking_start,version,updated_by)
    values(employee,company,mode,starts,expected+1,auth.uid())
    on conflict(employee_id) do update set mode=excluded.mode,tracking_start=excluded.tracking_start,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  result:=jsonb_build_object('employeeId',employee,'mode',mode,'trackingStart',starts,'version',expected+1);
  insert into app.workforce_management_events(company_id,employee_id,actor_id,before_value,after_value)
    values(company,employee,auth.uid(),jsonb_build_object('mode',previous_mode,'trackingStart',previous.tracking_start,'version',expected),result);
  return result;
end $$;

create table public.logistics_operation_records (
  id uuid primary key, company_id uuid not null references public.companies(id), employee_id uuid not null references public.profiles(id),
  employee_name text not null, kind text not null check(kind in ('work','leave')),
  from_date date not null, to_date date not null check(to_date>=from_date),
  started_at timestamptz, ended_at timestamptz, break_minutes integer not null default 0 check(break_minutes>=0),
  leave_kind text, leave_days numeric(6,2), note text not null default '' check(length(note)<=1000),
  version integer not null default 1 check(version>0), cancelled_at timestamptz,
  created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check((kind='work' and started_at is not null and ended_at is not null and ended_at>started_at and break_minutes<=extract(epoch from ended_at-started_at)/60
      and from_date=(started_at at time zone 'Asia/Seoul')::date and to_date=(ended_at at time zone 'Asia/Seoul')::date and leave_kind is null and leave_days is null)
    or (kind='leave' and started_at is null and ended_at is null and break_minutes=0 and leave_kind is not null and leave_days is not null and leave_kind in('annual','half','quarter','official','other')
      and leave_days>0 and leave_days*4=trunc(leave_days*4) and leave_days<=to_date-from_date+1))
);
create index logistics_operations_month on public.logistics_operation_records(company_id,from_date,id);
create index logistics_operations_employee on public.logistics_operation_records(employee_id,from_date,to_date) where cancelled_at is null;
create table public.logistics_operation_events (
  id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
  record_id uuid not null references public.logistics_operation_records(id), actor_id uuid not null references public.profiles(id),
  action text not null check(action in('created','updated','cancelled')), before_value jsonb, after_value jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index logistics_operations_events_record on public.logistics_operation_events(record_id,id);
alter table public.logistics_operation_records enable row level security;
alter table public.logistics_operation_events enable row level security;
revoke all on public.logistics_operation_records,public.logistics_operation_events from public,anon,authenticated;
grant select on public.logistics_operation_records,public.logistics_operation_events to authenticated;
create policy logistics_operations_read on public.logistics_operation_records for select to authenticated using(
  company_id=(select app.permission_company_id()) and (select app.logistics_operations_manager()));
create policy logistics_operations_events_read on public.logistics_operation_events for select to authenticated using(
  company_id=(select app.permission_company_id()) and (select app.logistics_operations_manager()));

create function app.get_logistics_operations(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id();
begin
  if not app.logistics_operations_manager() then raise exception '물류 운영관리 담당자만 사용할 수 있습니다.' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception '조회 기간을 확인해 주세요.' using errcode='22023'; end if;
  return jsonb_build_object('employees',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.display_name,'이름 미등록'),'hireDate',p.hire_date) order by p.display_name,p.id),'[]'::jsonb)
    from public.profiles p where p.company_id=company and p.status='active' and app.workforce_mode(p.id)='logistics'),
    'entries',(select coalesce(jsonb_agg(to_jsonb(r) order by r.from_date desc,r.created_at desc,r.id),'[]'::jsonb)
      from public.logistics_operation_records r where r.company_id=company and r.from_date between p_from and p_to));
end $$;

create function app.save_logistics_operation(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<logistics_input>>
declare company uuid:=app.permission_company_id(); previous public.logistics_operation_records%rowtype; target public.profiles%rowtype;
  record_id uuid:=(p_input->>'id')::uuid; employee uuid:=(p_input->>'employeeId')::uuid;
  expected integer:=(p_input->>'version')::integer; action text:=coalesce(p_input->>'action','save'); kind text:=p_input->>'kind';
  first_day date:=(p_input->>'from')::date; last_day date:=(p_input->>'to')::date;
  begins timestamptz:=(p_input->>'startedAt')::timestamptz; finishes timestamptz:=(p_input->>'endedAt')::timestamptz;
  pauses integer:=coalesce((p_input->>'breakMinutes')::integer,0); leave_type text:=p_input->>'leaveKind'; days numeric:=(p_input->>'leaveDays')::numeric;
  memo text:=coalesce(p_input->>'note',''); current_row public.logistics_operation_records%rowtype; same_value boolean;
begin
  if not app.logistics_operations_manager() then raise exception '물류 운영관리 담당자만 저장할 수 있습니다.' using errcode='42501'; end if;
  if record_id is null or expected is null or expected<0 or action not in ('save','cancel') then raise exception '등록 항목을 확인해 주세요.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('logistics_record:'||record_id::text,0));
  select * into previous from public.logistics_operation_records where id=record_id;
  if previous.id is not null and previous.company_id<>company then raise exception '관리할 수 없는 기록입니다.' using errcode='42501'; end if;
  if action='cancel' then
    if previous.id is null then raise exception '기록을 다시 조회해 주세요.' using errcode='40001'; end if;
    if previous.cancelled_at is not null then return jsonb_build_object('id',record_id,'version',previous.version); end if;
    if previous.version<>expected then raise exception '기록이 변경됐습니다. 새로 조회해 주세요.' using errcode='40001'; end if;
    update public.logistics_operation_records set cancelled_at=clock_timestamp(),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=record_id returning * into current_row;
    insert into public.logistics_operation_events(company_id,record_id,actor_id,action,before_value,after_value) values(company,record_id,auth.uid(),'cancelled',to_jsonb(previous),to_jsonb(current_row));
    return jsonb_build_object('id',record_id,'version',current_row.version);
  end if;
  if employee is null or kind is null or kind not in ('work','leave') or length(memo)>1000 then raise exception '직원·종류·메모를 확인해 주세요.' using errcode='22023'; end if;
  select * into target from public.profiles where id=employee and company_id=company and status='active' for share;
  if not found or app.workforce_mode(employee)<>'logistics' then raise exception '물류 별도 관리 대상 직원만 기록할 수 있습니다.' using errcode='42501'; end if;
  if previous.employee_id is not null and previous.employee_id<>employee then raise exception '기존 기록의 직원을 바꿀 수 없습니다.' using errcode='22023'; end if;
  if previous.cancelled_at is not null then raise exception '취소한 기록은 새 항목으로 등록해 주세요.' using errcode='22023'; end if;
  if kind='work' then
    if begins is null or finishes is null or finishes<=begins or pauses<0 or pauses>extract(epoch from finishes-begins)/60 then raise exception '근무 시작·종료와 휴게시간을 확인해 주세요.' using errcode='22023'; end if;
    first_day:=(begins at time zone 'Asia/Seoul')::date;last_day:=(finishes at time zone 'Asia/Seoul')::date;leave_type:=null;days:=null;
  else
    if first_day is null or last_day is null or last_day<first_day or leave_type is null or leave_type not in ('annual','half','quarter','official','other')
      or days is null or days<=0 or days*4<>trunc(days*4) or days>last_day-first_day+1 then raise exception '휴가 기간·종류·일수를 확인해 주세요.' using errcode='22023'; end if;
    begins:=null;finishes:=null;pauses:=0;
  end if;
  same_value:=previous.id is not null and previous.employee_id=employee and previous.kind=kind and previous.from_date=first_day and previous.to_date=last_day
    and previous.started_at is not distinct from begins and previous.ended_at is not distinct from finishes and previous.break_minutes=pauses
    and previous.leave_kind is not distinct from leave_type and previous.leave_days is not distinct from days and previous.note=memo;
  if same_value then return jsonb_build_object('id',record_id,'version',previous.version); end if;
  if coalesce(previous.version,0)<>expected then raise exception '기록이 변경됐습니다. 새로 조회해 주세요.' using errcode='40001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('logistics_employee:'||employee::text,0));
  if exists(select 1 from public.logistics_operation_records r where r.employee_id=employee and r.company_id=company and r.id<>record_id and r.cancelled_at is null and r.kind=logistics_input.kind
    and case when logistics_input.kind='work' then r.started_at<finishes and begins<r.ended_at else r.from_date<=last_day and first_day<=r.to_date end) then
    raise exception '겹치는 기록이 있습니다. 기존 기록을 확인·수정해 주세요.' using errcode='22023';
  end if;
  insert into public.logistics_operation_records(id,company_id,employee_id,employee_name,kind,from_date,to_date,started_at,ended_at,break_minutes,leave_kind,leave_days,note,version,created_by,updated_by)
    values(record_id,company,employee,coalesce(target.display_name,'이름 미등록'),kind,first_day,last_day,begins,finishes,pauses,leave_type,days,memo,expected+1,auth.uid(),auth.uid())
    on conflict(id) do update set employee_name=excluded.employee_name,kind=excluded.kind,from_date=excluded.from_date,to_date=excluded.to_date,started_at=excluded.started_at,ended_at=excluded.ended_at,
      break_minutes=excluded.break_minutes,leave_kind=excluded.leave_kind,leave_days=excluded.leave_days,note=excluded.note,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp()
    returning * into current_row;
  insert into public.logistics_operation_events(company_id,record_id,actor_id,action,before_value,after_value) values(company,record_id,auth.uid(),case when previous.id is null then 'created' else 'updated' end,case when previous.id is null then null else to_jsonb(previous) end,to_jsonb(current_row));
  return jsonb_build_object('id',record_id,'version',current_row.version);
end $$;

create function public.list_workforce_management() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_workforce_management()$$;
create function public.save_workforce_management(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$select app.save_workforce_management(p_input)$$;
create function public.get_logistics_operations(p_from date,p_to date) returns jsonb language sql stable security invoker set search_path='' as $$select app.get_logistics_operations(p_from,p_to)$$;
create function public.save_logistics_operation(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$select app.save_logistics_operation(p_input)$$;
revoke all on function app.list_workforce_management(),app.save_workforce_management(jsonb),app.get_logistics_operations(date,date),app.save_logistics_operation(jsonb),public.list_workforce_management(),public.save_workforce_management(jsonb),public.get_logistics_operations(date,date),public.save_logistics_operation(jsonb) from public,anon,authenticated;
grant execute on function app.list_workforce_management(),app.save_workforce_management(jsonb),app.get_logistics_operations(date,date),app.save_logistics_operation(jsonb),public.list_workforce_management(),public.save_workforce_management(jsonb),public.get_logistics_operations(date,date),public.save_logistics_operation(jsonb) to authenticated;

-- Narrow only the new clients' HR inbox views. Source events/read receipts remain intact.
-- This private helper reveals only a same-company management classification, never source contents.
create function app.hr_notice_target_in_scope(p_entity uuid,p_source text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id(); employee uuid;
begin
  if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  if p_source is null or p_source not in('work','late','self') then raise exception '알림 종류를 확인해 주세요.' using errcode='22023'; end if;
  if p_source='self' then return app.workforce_mode(auth.uid())='head-office'; end if;
  if p_entity is null then return true; end if;
  if p_source='late' then
    select s.employee_id into employee from public.late_arrival_statements s join public.profiles p on p.id=s.employee_id and p.company_id=company where s.id=p_entity;
  else
    select r.employee_id into employee from public.company_leave_requests r join public.profiles p on p.id=r.employee_id and p.company_id=company where r.id=p_entity;
    if not found then select d.employee_id into employee from app.holiday_work_days d join public.profiles p on p.id=d.employee_id and p.company_id=company where d.id=p_entity; end if;
  end if;
  return employee is null or app.workforce_mode(employee)='head-office';
end $$;
revoke all on function app.hr_notice_target_in_scope(uuid,text) from public,anon,authenticated;
grant execute on function app.hr_notice_target_in_scope(uuid,text) to authenticated;
create function app.list_my_managed_work_notifications() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if app.permission_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(n.item order by n.ordinality),'[]'::jsonb)
    from jsonb_array_elements(public.list_my_home_work_notifications()) with ordinality n(item,ordinality)
    cross join lateral (select case when n.item->>'entity_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then (n.item->>'entity_id')::uuid end id) entity
    where (coalesce(n.item->>'event_type','')<>'checkout' or (select app.hr_notice_target_in_scope(null,'self')))
      and app.hr_notice_target_in_scope(entity.id,'work'));
end $$;
create function app.list_my_managed_late_notices() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if app.permission_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) from public.list_my_late_statement_notices() n where app.hr_notice_target_in_scope(n.statement_id,'late'));
end $$;
create function public.list_my_managed_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_managed_work_notifications()$$;
create function public.list_my_managed_late_notices() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_managed_late_notices()$$;
revoke all on function app.list_my_managed_work_notifications(),app.list_my_managed_late_notices(),public.list_my_managed_work_notifications(),public.list_my_managed_late_notices() from public,anon,authenticated;
grant execute on function app.list_my_managed_work_notifications(),app.list_my_managed_late_notices(),public.list_my_managed_work_notifications(),public.list_my_managed_late_notices() to authenticated;

-- Keep each existing body, ACL, signature and configuration; prepend only the scope guard.
do $guards$
declare item record; target regprocedure; body text; definition text; replacement text;
begin
  for item in select * from (values
    ('app.refresh_employee_leave(uuid,date)', 'if app.workforce_mode(p_employee) is distinct from ''head-office'' then return; end if;'),
    ('app.ensure_employee_birthday_leave(uuid,date)', 'if app.workforce_mode(p_employee) is distinct from ''head-office'' then return; end if;'),
    ('app.advance_attendance_presence(uuid,timestamp with time zone)', 'if not exists(select 1 from public.attendance_clock_ins c where c.id=p_clock_id and app.workforce_mode(c.employee_id)=''head-office'') then return; end if;'),
    ('app.dispatch_extra_leave_grant_notice(uuid)', 'if not exists(select 1 from app.employee_extra_leave g where g.id=p_grant and app.workforce_mode(g.employee_id)=''head-office'') then return 0; end if;')
  ) g(signature,guard) loop
    target:=to_regprocedure(item.signature);
    if target is null then raise exception 'Required workforce boundary function missing: %',item.signature; end if;
    select p.prosrc,pg_get_functiondef(p.oid) into body,definition from pg_proc p where p.oid=target;
    if position('-- workforce management boundary' in body)>0 then continue; end if;
    replacement:=regexp_replace(body,'\mbegin\M',E'begin\n-- workforce management boundary\n'||item.guard,'i');
    if replacement=body then raise exception 'Workforce boundary insertion failed: %',item.signature; end if;
    execute replace(definition,body,replacement);
  end loop;
  for item in select * from (values
    ('app.dispatch_leave_usage_notices_before_extra()', 'where p.status=''active''', 'where app.workforce_mode(p.id)=''head-office'' and p.status=''active'''),
    ('app.process_attendance_presence()', 'where r.kind=''offsite''', 'where app.workforce_mode(r.employee_id)=''head-office'' and r.kind=''offsite''')
  ) g(signature,needle,inserted) loop
    target:=to_regprocedure(item.signature);
    if target is null then raise exception 'Required workforce worker missing: %',item.signature; end if;
    select p.prosrc,pg_get_functiondef(p.oid) into body,definition from pg_proc p where p.oid=target;
    if position(item.inserted in body)>0 then continue; end if;
    if position(item.needle in body)=0 then raise exception 'Workforce worker changed; review required: %',item.signature; end if;
    execute replace(definition,body,replace(body,item.needle,item.inserted));
  end loop;
end $guards$;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.workforce_management_overrides,public.logistics_operation_records;
  end if;
end $$;
