begin;

create table app.departure_handover_cases (
  employee_id uuid primary key references app.employee_departures(employee_id),
  company_id uuid not null references public.companies(id),
  department_id uuid references public.departments(id),
  coordinator_id uuid references public.profiles(id)
);
create index departure_handover_cases_company on app.departure_handover_cases(company_id);
create table app.departure_handover_reads (
  employee_id uuid not null references app.departure_handover_cases(employee_id),
  reader_id uuid not null references public.profiles(id),
  version text not null,
  read_at timestamptz not null default clock_timestamp(),
  primary key(employee_id, reader_id, version)
);
create table app.departure_handover_recommendations (
  employee_id uuid not null references app.departure_handover_cases(employee_id),
  item_key text not null,
  successor_id uuid not null references public.profiles(id),
  recommended_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(employee_id, item_key)
);
alter table app.departure_handover_cases enable row level security;
alter table app.departure_handover_reads enable row level security;
alter table app.departure_handover_recommendations enable row level security;
revoke all on app.departure_handover_cases, app.departure_handover_reads, app.departure_handover_recommendations from public, anon, authenticated;

create table public.departure_handover_signals (
  recipient_id uuid primary key references public.profiles(id),
  refreshed_at timestamptz not null default clock_timestamp()
);
alter table public.departure_handover_signals enable row level security;
revoke all on public.departure_handover_signals from public,anon,authenticated;
grant select on public.departure_handover_signals to authenticated;
create policy departure_handover_signals_self on public.departure_handover_signals for select to authenticated
  using (recipient_id=(select auth.uid()) and (select app.permission_company_id()) is not null);
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.departure_handover_signals;
  end if;
end $$;

create function app.departure_handover_coordinator(p_company uuid,p_department uuid,p_employee uuid,p_preferred uuid default null)
returns uuid language sql stable set search_path='' as $$
  select p.id from public.department_request_approvers a
  join public.departments d on d.id=a.department_id and d.is_active
  cross join lateral (values (a.approver_id,0),(a.substitute_id,1)) choice(id,priority)
  join public.profiles p on p.id=choice.id and p.company_id=a.company_id and p.status='active'
  where a.company_id=p_company and a.department_id=p_department and p.id<>p_employee
  order by (p.id is distinct from p_preferred), (a.request_type<>'overtime'), choice.priority,p.id limit 1
$$;

create function app.open_departure_handover_case() returns trigger
language plpgsql set search_path='' as $$
begin
  insert into app.departure_handover_cases(employee_id,company_id,department_id,coordinator_id)
  select new.employee_id,new.company_id,p.department_id,
    app.departure_handover_coordinator(new.company_id,p.department_id,new.employee_id)
  from public.profiles p where p.id=new.employee_id;
  return new;
end;
$$;
create trigger open_departure_handover_case after insert on app.employee_departures
  for each row execute function app.open_departure_handover_case();

insert into app.departure_handover_cases(employee_id,company_id,department_id,coordinator_id)
select e.employee_id,e.company_id,p.department_id,app.departure_handover_coordinator(e.company_id,p.department_id,e.employee_id)
from app.employee_departures e join public.profiles p on p.id=e.employee_id;

create function app.signal_departure_handover_case() returns trigger
language plpgsql set search_path='' as $$
begin
  insert into public.departure_handover_signals(recipient_id)
  select distinct recipient.id from app.departure_handover_cases c
  cross join lateral (values(c.coordinator_id),(app.departure_handover_coordinator(c.company_id,c.department_id,c.employee_id,c.coordinator_id))) recipient(id)
  where c.employee_id=new.employee_id and recipient.id is not null
  on conflict(recipient_id) do update set refreshed_at=excluded.refreshed_at;
  return new;
end;
$$;
create trigger signal_departure_handover_open after insert on app.departure_handover_cases
  for each row execute function app.signal_departure_handover_case();
create trigger signal_departure_handover_update after insert on app.employee_departure_handover_events
  for each row execute function app.signal_departure_handover_case();

do $preview$
declare definition text := pg_get_functiondef('app.preview_employee_departure(uuid)'::regprocedure);
  anchor constant text := $key$'canHandoverApprovals', app.can_edit_org_assignment(),$key$;
begin
  if strpos(definition,anchor)=0 then raise exception '운영지원 인계 상태 조회 기준이 변경되었습니다.'; end if;
  execute replace(definition,anchor,anchor||$field$
    'handoverCoordinator',(select p.display_name from public.profiles p where p.id=app.departure_handover_coordinator(
      company,employee.department_id,p_employee,(select coordinator_id from app.departure_handover_cases where employee_id=p_employee))),$field$);
end;
$preview$;

-- Reuse the existing transfer and audit rules with a private, server-authorized
-- item selection. Keep the legacy HR entry points and their signature intact.
do $migration$
declare
  definition text := pg_get_functiondef('app.transfer_employee_departure_work(uuid,uuid,uuid,uuid,jsonb,text,uuid,timestamptz)'::regprocedure);
  anchor constant text := '  if p_work_successor is not null then';
  approval_anchor constant text := 'where p_approval_successor is not null and a.company_id = company and p_employee in (a.approver_id, a.substitute_id);';
begin
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
    or strpos(definition,'p_event_time timestamp with time zone)')=0
    or strpos(definition,'CREATE OR REPLACE FUNCTION app.transfer_employee_departure_work(')=0
    or strpos(definition,approval_anchor)=0 then
    raise exception '퇴사 인계 함수의 선택 항목 적용 기준이 변경되었습니다.';
  end if;
  execute replace(replace(replace(replace(definition,
    'CREATE OR REPLACE FUNCTION app.transfer_employee_departure_work(', 'CREATE FUNCTION app.transfer_selected_departure_item('),
    'p_event_time timestamp with time zone)', 'p_event_time timestamp with time zone, p_item text)'),
    anchor,$selection$
  select jsonb_object_agg(w.key,coalesce((select jsonb_agg(entry order by ord)
    from jsonb_array_elements(w.value) with ordinality a(entry,ord) where w.key||'/'||(entry->>0)=p_item),'[]'))
  into work from jsonb_each(work) w;

  if p_work_successor is not null then$selection$),approval_anchor,
  'where p_approval_successor is not null and a.company_id = company and p_employee in (a.approver_id, a.substitute_id) and p_item = ''approvals/''||a.department_id;');
end;
$migration$;

create function app.departure_handover_items(p_company uuid,p_employee uuid)
returns table(item_key text,kind text,owner text,label text,department_id uuid)
language sql stable set search_path='' as $$
  with pending as (select app.employee_departure_work(p_company,p_employee) as work)
  select 'personal/'||c.id,'personal',null::text,c.title,null::uuid
    from pending cross join lateral jsonb_array_elements(work->'personal') x join app.personal_work_cards c on c.id=(x->>0)::uuid
  union all select 'sent/'||w.id,'sent',w.owner,coalesce(nullif(w.data->'values'->>'title',''),'보낸 요청'),null::uuid
    from pending cross join lateral jsonb_array_elements(work->'sent') x join public.work_requests w on w.id=(x->>0)::uuid
  union all select 'requests/'||w.id,'requests',w.owner,coalesce(nullif(w.data->'values'->>'title',''),'진행 중 작업 요청'),app.work_department(w.owner)
    from pending cross join lateral jsonb_array_elements(work->'requests') x join public.work_requests w on w.id=(x->>0)::uuid
  union all select 'settings/'||(x->>0),'settings',x->>0,'작업 요청 담당 설정',app.work_department(x->>0)
    from pending cross join lateral jsonb_array_elements(work->'settings') x
  union all select distinct 'approvals/'||d.id,'approvals',null::text,d.name||' 근태·야근 승인 담당',d.id
    from pending cross join lateral jsonb_array_elements(work->'approvals') x join public.departments d on d.id=(x->>0)::uuid and d.is_active;
$$;

create function app.departure_handover_can_apply(p_kind text,p_owner text,p_is_coordinator boolean)
returns boolean language sql stable set search_path='' as $$
  select case p_kind
    when 'approvals' then app.can_edit_org_assignment()
    when 'personal' then p_is_coordinator
    when 'sent' then p_is_coordinator
    else app.work_manage_allowed(p_owner) or (app.can_manage_personnel() and app.assignment_manager())
  end
$$;

create function app.departure_handover_direct_login() returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from auth.sessions s join auth.mfa_amr_claims m on m.session_id=s.id
    where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and m.authentication_method in ('oauth','password'))
$$;

create function app.departure_handover_state(p_case app.departure_handover_cases,p_actor uuid)
returns table(is_coordinator boolean,items jsonb,version text,has_access boolean)
language sql stable set search_path='' as $$
  with role_info as (
    select coalesce(app.departure_handover_coordinator(p_case.company_id,p_case.department_id,p_case.employee_id,p_case.coordinator_id)=p_actor,false) as coordinator
  ), visible as (
    select i.*, r.successor_id,r.updated_at, a.coordinator,
      app.departure_handover_can_apply(i.kind,i.owner,a.coordinator) as can_apply
    from role_info a cross join app.departure_handover_items(p_case.company_id,p_case.employee_id) i
    left join app.departure_handover_recommendations r on r.employee_id=p_case.employee_id and r.item_key=i.item_key
    where a.coordinator or (r.successor_id is not null and app.departure_handover_can_apply(i.kind,i.owner,false))
  )
  select a.coordinator,
    coalesce((select jsonb_agg(jsonb_build_object('key',i.item_key,'kind',i.kind,'owner',i.owner,
      'label',case when i.kind='requests' and not i.can_apply then '진행 중 작업 요청' else i.label end,
      'departmentId',i.department_id,'canApply',i.can_apply,'suggestedId',i.successor_id) order by i.kind,i.item_key) from visible i),'[]'),
    case when a.coordinator then 'coordinator' else md5(coalesce((select string_agg(i.item_key||i.updated_at::text,',' order by i.item_key) from visible i),'')) end,
    a.coordinator or exists(select 1 from visible)
  from role_info a;
$$;

create function app.list_departure_handover_notices() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',q.employee_id,'employeeName',q.display_name,'departmentName',q.department_name,
    'resignedOn',q.resigned_on,'createdAt',q.processed_at,'version',q.version,'readAt',q.read_at,
    'pending',q.pending,'review',not q.is_coordinator) order by (q.pending>0) desc,q.processed_at desc),'[]')
  from (
    select c.employee_id,p.display_name,d.name department_name,e.resigned_on,e.processed_at,s.version,s.is_coordinator,r.read_at,
      jsonb_array_length(s.items) pending
    from app.departure_handover_cases c join app.employee_departures e on e.employee_id=c.employee_id
    join public.profiles p on p.id=c.employee_id left join public.departments d on d.id=c.department_id
    cross join lateral app.departure_handover_state(c,auth.uid()) s
    left join app.departure_handover_reads r on r.employee_id=c.employee_id and r.reader_id=auth.uid() and r.version=s.version
    where (select app.departure_handover_direct_login()) and c.company_id=(select app.permission_company_id()) and s.has_access
      and (jsonb_array_length(s.items)>0 or exists(select 1 from app.departure_handover_reads h where h.employee_id=c.employee_id and h.reader_id=auth.uid()))
    order by (jsonb_array_length(s.items)>0) desc,e.processed_at desc limit 100
  ) q;
$$;

create function app.get_departure_handover(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c app.departure_handover_cases; s record;
begin
  if not app.departure_handover_direct_login() then
    raise exception '본인 계정으로 로그인한 뒤 퇴사 인계를 열어 주세요.' using errcode='42501';
  end if;
  select * into c from app.departure_handover_cases where employee_id=p_employee and company_id=app.permission_company_id();
  if not found then raise exception '퇴사 인계 내용을 열 수 없습니다.' using errcode='42501'; end if;
  select * into s from app.departure_handover_state(c,auth.uid());
  if not s.has_access then raise exception '퇴사 인계 내용을 열 수 없습니다.' using errcode='42501'; end if;
  return jsonb_build_object('id',c.employee_id,'version',s.version,'revision',md5(app.employee_departure_work(c.company_id,c.employee_id)::text||s.items::text),
    'items',s.items,'readAt',(select read_at from app.departure_handover_reads r
      where r.employee_id=c.employee_id and r.reader_id=auth.uid() and r.version=s.version),
    'employeeName',(select display_name from public.profiles where id=c.employee_id),
    'departmentName',(select name from public.departments where id=c.department_id),
    'resignedOn',(select resigned_on from app.employee_departures where employee_id=c.employee_id),
    'candidates',case when jsonb_array_length(s.items)=0 then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.display_name,'departmentId',p.department_id,'departmentName',d.name) order by p.display_name,p.id)
      from public.profiles p left join public.departments d on d.id=p.department_id
      where p.company_id=c.company_id and p.status='active' and p.id<>c.employee_id),'[]') end);
end;
$$;

create function app.save_departure_handover(p_employee uuid,p_revision text,p_choices jsonb,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c app.departure_handover_cases;
  actor uuid := auth.uid();
  company uuid := app.permission_company_id();
  detail jsonb;
  choice record;
  item jsonb;
  next_employee uuid;
  requested boolean;
  changes jsonb := '[]';
  changed_at timestamptz;
begin
  if company is null or not app.departure_handover_direct_login() then
    raise exception '본인 계정으로 로그인한 뒤 퇴사 인계를 진행해 주세요.' using errcode='42501';
  end if;
  if p_command is null or jsonb_typeof(p_choices) is distinct from 'object' then
    raise exception '인계할 업무와 후임자를 선택해 주세요.' using errcode='22023';
  end if;
  if p_choices='{}' or (select count(*) from jsonb_each(p_choices))>100 then
    raise exception '인계할 항목을 1건 이상 선택해 주세요.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(company::text,0));
  if company is distinct from app.permission_company_id() or not app.departure_handover_direct_login() then
    raise exception '퇴사 인계 권한을 다시 확인해 주세요.' using errcode='42501';
  end if;
  select * into c from app.departure_handover_cases where employee_id=p_employee and company_id=company for update;
  if not found then raise exception '퇴사 인계 내용을 열 수 없습니다.' using errcode='42501'; end if;
  if exists(select 1 from app.employee_departure_handover_events where command_id=p_command and employee_id=p_employee and actor_id=actor) then
    return jsonb_build_object('duplicate',true);
  end if;
  detail := app.get_departure_handover(p_employee);
  if p_revision is distinct from detail->>'revision' then
    raise exception '인계할 항목이 바뀌었습니다. 다시 조회해 주세요.' using errcode='40001';
  end if;
  changed_at := clock_timestamp();
  for choice in select key,value from jsonb_each_text(p_choices) order by key loop
    select value into item from jsonb_array_elements(detail->'items') where value->>'key'=choice.key;
    if not found then raise exception '처리할 수 없는 인계 항목이 있습니다.' using errcode='42501'; end if;
    select p.id into next_employee from public.profiles p where p.id::text=choice.value and p.company_id=company
      and p.status='active' and p.id<>p_employee
      and (item->>'kind' not in ('requests','settings') or p.department_id::text=item->>'departmentId') for share;
    if not found then raise exception '인계를 받을 재직 직원을 다시 확인해 주세요.' using errcode='22023'; end if;

    requested := not (item->>'canApply')::boolean;
    if requested then
      insert into app.departure_handover_recommendations(employee_id,item_key,successor_id,recommended_by)
      values(p_employee,choice.key,next_employee,actor)
      on conflict(employee_id,item_key) do update set successor_id=excluded.successor_id,recommended_by=excluded.recommended_by,updated_at=clock_timestamp()
      where departure_handover_recommendations.successor_id is distinct from excluded.successor_id;
    else
      perform app.transfer_selected_departure_item(company,p_employee,
        case when item->>'kind' in ('personal','sent') then next_employee end,
        case when item->>'kind'='approvals' then next_employee end,
        case when item->>'kind' in ('requests','settings') then jsonb_build_object(item->>'owner',next_employee) else '{}'::jsonb end,
        md5(app.employee_departure_work(company,p_employee)::text),p_command,changed_at,choice.key);
      delete from app.departure_handover_recommendations where employee_id=p_employee and item_key=choice.key;
    end if;
    changes := changes||jsonb_build_array(jsonb_build_object('key',choice.key,'successor',next_employee,'recommended',requested));
  end loop;
  insert into app.employee_departure_handover_events(command_id,employee_id,actor_id,created_at,transferred)
  values(p_command,p_employee,actor,changed_at,jsonb_build_object('items',changes));
  return jsonb_build_object('applied',(select count(*) from jsonb_array_elements(changes) x where x->>'recommended'='false'),
    'recommended',(select count(*) from jsonb_array_elements(changes) x where x->>'recommended'='true'));
end;
$$;

create function app.read_departure_handover(p_employee uuid,p_version text) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare detail jsonb := app.get_departure_handover(p_employee); read_time timestamptz;
begin
  if p_version is distinct from detail->>'version' then return null; end if;
  insert into app.departure_handover_reads(employee_id,reader_id,version) values(p_employee,auth.uid(),p_version)
    on conflict(employee_id,reader_id,version) do nothing;
  if found then
    insert into public.departure_handover_signals(recipient_id) values(auth.uid())
      on conflict(recipient_id) do update set refreshed_at=excluded.refreshed_at;
  end if;
  select read_at into read_time from app.departure_handover_reads where employee_id=p_employee and reader_id=auth.uid() and version=p_version;
  return read_time;
end;
$$;

create function public.list_departure_handover_notices() returns jsonb
language sql stable set search_path='' as $$ select app.list_departure_handover_notices() $$;
create function public.get_departure_handover(p_employee uuid) returns jsonb
language sql stable set search_path='' as $$ select app.get_departure_handover(p_employee) $$;
create function public.read_departure_handover(p_employee uuid,p_version text) returns timestamptz
language sql set search_path='' as $$ select app.read_departure_handover(p_employee,p_version) $$;
create function public.save_departure_handover(p_employee uuid,p_revision text,p_choices jsonb,p_command uuid) returns jsonb
language sql set search_path='' as $$ select app.save_departure_handover(p_employee,p_revision,p_choices,p_command) $$;

revoke all on function app.departure_handover_coordinator(uuid,uuid,uuid,uuid),app.open_departure_handover_case(),app.signal_departure_handover_case(),
  app.transfer_selected_departure_item(uuid,uuid,uuid,uuid,jsonb,text,uuid,timestamptz,text),app.departure_handover_items(uuid,uuid),
  app.departure_handover_can_apply(text,text,boolean),app.departure_handover_direct_login(),app.departure_handover_state(app.departure_handover_cases,uuid)
  from public,anon,authenticated;
revoke all on function app.list_departure_handover_notices(),app.get_departure_handover(uuid),app.read_departure_handover(uuid,text),
  app.save_departure_handover(uuid,text,jsonb,uuid),public.list_departure_handover_notices(),public.get_departure_handover(uuid),
  public.read_departure_handover(uuid,text),public.save_departure_handover(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function app.list_departure_handover_notices(),app.get_departure_handover(uuid),app.read_departure_handover(uuid,text),
  app.save_departure_handover(uuid,text,jsonb,uuid),public.list_departure_handover_notices(),public.get_departure_handover(uuid),
  public.read_departure_handover(uuid,text),public.save_departure_handover(uuid,text,jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
