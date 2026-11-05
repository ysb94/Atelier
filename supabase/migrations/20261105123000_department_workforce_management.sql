-- Department/team classifications. Prepared only; shared DB approval required.
-- Does not install the earlier employee-override or manual-logistics migration.
create table public.department_workforce_policies (
  department_id uuid primary key references public.departments(id),
  company_id uuid not null references public.companies(id),
  mode text not null check(mode in ('head-office','local','external')),
  tracking_start date,
  version integer not null check(version>0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  check ((mode='head-office' and tracking_start>='2026-11-02' and tracking_start is not null) or (mode<>'head-office' and tracking_start is null))
);
create index department_workforce_company on public.department_workforce_policies(company_id,department_id);
alter table public.department_workforce_policies enable row level security;
revoke all on public.department_workforce_policies from public,anon,authenticated;
grant select on public.department_workforce_policies to authenticated;
create policy department_workforce_read on public.department_workforce_policies for select to authenticated using(company_id=(select app.permission_company_id()));
create table app.department_workforce_events (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 department_id uuid not null references public.departments(id), actor_id uuid not null references public.profiles(id),
 before_value jsonb not null, after_value jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table app.department_workforce_events enable row level security;
revoke all on app.department_workforce_events from public,anon,authenticated;

create or replace function app.department_workforce_mode(p_company uuid,p_department uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select w.mode from public.department_workforce_policies w join public.departments d on d.id=w.department_id and d.company_id=w.company_id and d.is_active
 where w.company_id=p_company and w.department_id=p_department),case
 when p_company='e0000000-0000-4000-8000-000000000001' and p_department='bf926822-910c-422f-9c17-5fd3d8ddb3ba' then 'external'
 when p_company='e0000000-0000-4000-8000-000000000001' and p_department='c5d4cfca-97ce-4ca7-b30a-6beed842cf1e' then 'local'
 else 'head-office' end)
$$;
create or replace function app.workforce_mode(p_employee uuid) returns text language sql stable security definer set search_path='' as $$
 select case when app.department_workforce_mode(p.company_id,p.department_id)='local' and p.company_id='e0000000-0000-4000-8000-000000000001' and p.department_id='c5d4cfca-97ce-4ca7-b30a-6beed842cf1e' then 'logistics'
 else app.department_workforce_mode(p.company_id,p.department_id) end from public.profiles p where p.id=p_employee
$$;
revoke all on function app.department_workforce_mode(uuid,uuid),app.workforce_mode(uuid) from public,anon,authenticated;

create or replace function app.list_department_workforce_management() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id();
begin
 if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('departmentId',d.id,'mode',app.department_workforce_mode(company,d.id),'trackingStart',w.tracking_start,'version',coalesce(w.version,0)) order by d.sort_order,d.id),'[]'::jsonb)
 from public.departments d left join public.department_workforce_policies w on w.department_id=d.id and w.company_id=company where d.company_id=company and d.is_active);
end$$;
create or replace function app.list_workforce_management() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id();
begin
 if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('employeeId',p.id,'mode',app.workforce_mode(p.id),'trackingStart',w.tracking_start,'version',coalesce(w.version,0)) order by p.id),'[]'::jsonb)
 from public.profiles p left join public.departments d on d.id=p.department_id and d.company_id=p.company_id and d.is_active
 left join public.department_workforce_policies w on w.department_id=d.id and w.company_id=company where p.company_id=company and p.status='active');
end$$;
create or replace function app.save_department_workforce_management(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare company uuid:=app.permission_company_id(); dept uuid:=(p_input->>'departmentId')::uuid;
 selected text:=p_input->>'mode'; starts date:=(p_input->>'trackingStart')::date; expected integer:=(p_input->>'version')::integer;
 previous public.department_workforce_policies%rowtype; old_mode text; result jsonb; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if company is null or app.can_edit_org_assignment() is not true then raise exception '조직 관리 권한이 필요합니다.' using errcode='42501';end if;
 if dept is null or selected is null or selected not in('head-office','local','external') or expected is null or expected<0 then raise exception '부서와 관리 방식을 확인해 주세요.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('department-workforce:'||dept::text,0));
 perform 1 from public.departments where id=dept and company_id=company and is_active for share;
 if not found then raise exception '같은 회사의 활성 부서만 설정할 수 있습니다.' using errcode='42501';end if;
 select * into previous from public.department_workforce_policies where department_id=dept;
 if coalesce(previous.version,0)<>expected then raise exception '부서 설정이 변경됐습니다. 새로 조회해 주세요.' using errcode='40001';end if;
 old_mode:=app.department_workforce_mode(company,dept);
 if selected='head-office' then
   if starts is null or starts<'2026-11-02' or (old_mode<>'head-office' and starts<today) then raise exception '본사 관리 전환은 오늘 이후 시작일을 지정해 주세요.' using errcode='22023';end if;
 else starts:=null;end if;
 if previous.mode=selected and previous.tracking_start is not distinct from starts then return jsonb_build_object('departmentId',dept,'mode',selected,'trackingStart',starts,'version',expected);end if;
 insert into public.department_workforce_policies(department_id,company_id,mode,tracking_start,version,updated_by) values(dept,company,selected,starts,expected+1,auth.uid())
 on conflict(department_id) do update set mode=excluded.mode,tracking_start=excluded.tracking_start,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 result:=jsonb_build_object('departmentId',dept,'mode',selected,'trackingStart',starts,'version',expected+1);
 insert into app.department_workforce_events(company_id,department_id,actor_id,before_value,after_value) values(company,dept,auth.uid(),jsonb_build_object('mode',old_mode,'trackingStart',previous.tracking_start,'version',expected),result);
 return result;
end$$;
create or replace function public.list_department_workforce_management() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_department_workforce_management()$$;
create or replace function public.list_workforce_management() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_workforce_management()$$;
create or replace function public.save_department_workforce_management(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$select app.save_department_workforce_management(p_input)$$;
revoke all on function app.list_department_workforce_management(),app.list_workforce_management(),app.save_department_workforce_management(jsonb),public.list_department_workforce_management(),public.list_workforce_management(),public.save_department_workforce_management(jsonb) from public,anon,authenticated;
grant execute on function app.list_department_workforce_management(),app.list_workforce_management(),app.save_department_workforce_management(jsonb),public.list_department_workforce_management(),public.list_workforce_management(),public.save_department_workforce_management(jsonb) to authenticated;

-- Narrow only the new clients' HR inbox views. Source events/read receipts remain intact.
-- This private helper reveals only a same-company management classification, never source contents.
create or replace function app.hr_notice_target_in_scope(p_entity uuid,p_source text) returns boolean language plpgsql stable security definer set search_path='' as $$
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
create or replace function app.list_my_managed_work_notifications() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if app.permission_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(n.item order by n.ordinality),'[]'::jsonb)
    from jsonb_array_elements(public.list_my_home_work_notifications()) with ordinality n(item,ordinality)
    cross join lateral (select case when n.item->>'entity_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then (n.item->>'entity_id')::uuid end id) entity
    where (coalesce(n.item->>'event_type','')<>'checkout' or (select app.hr_notice_target_in_scope(null,'self')))
      and app.hr_notice_target_in_scope(entity.id,'work'));
end $$;
create or replace function app.list_my_managed_late_notices() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if app.permission_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) from public.list_my_late_statement_notices() n where app.hr_notice_target_in_scope(n.statement_id,'late'));
end $$;
create or replace function public.list_my_managed_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_managed_work_notifications()$$;
create or replace function public.list_my_managed_late_notices() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_managed_late_notices()$$;
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

do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.department_workforce_policies;
 end if;
end$$;

-- Retire the earlier person-level write endpoint if that unapplied migration is installed later as a chain.
do $$declare signature text;target regprocedure;begin
 foreach signature in array array['app.save_workforce_management(jsonb)','public.save_workforce_management(jsonb)'] loop
 target:=to_regprocedure(signature);
 if target is not null then execute format('revoke all on function %s from public,anon,authenticated',target);end if;
 end loop;
end$$;
