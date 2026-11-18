-- Let active Visual supervisors edit request forms while keeping administrator assignments protected.
create or replace function app.get_work_request_settings(p_owner text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_settings public.work_request_settings;
  v_can_manage boolean;
  v_supervisors uuid[];
begin
  if v_company is null or p_owner is distinct from 'design' then
    raise exception '설정 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  select * into v_settings from public.work_request_settings where company_id = v_company and owner = p_owner;
  v_can_manage := app.work_manage_allowed(p_owner);
  v_supervisors := app.active_visual_work_supervisors(v_company, v_settings.supervisor_ids);
  return jsonb_build_object('revision', coalesce(v_settings.revision, 0),
    'categories', coalesce(v_settings.categories, '[]'::jsonb), 'canManage', v_can_manage,
    'canEditForm', v_can_manage or auth.uid() = any(v_supervisors),
    'supervisorIds', coalesce(v_settings.supervisor_ids, '{}'::uuid[]),
    'activeSupervisorIds', v_supervisors);
end $$;

create or replace function app.save_work_request_settings(p_owner text, p_revision bigint, p_categories jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  company uuid := app.permission_company_id();
  current_settings public.work_request_settings;
  next_revision bigint;
  can_manage boolean;
  category jsonb;
  field jsonb;
  person uuid;
  previous_assignee text;
begin
  if company is null or p_owner is distinct from 'design' then
    raise exception 'Visual 요청 양식 수정 권한이 없습니다.' using errcode = '42501';
  end if;
  if not app.work_manage_allowed(p_owner) and not exists (
    select 1 from public.work_request_settings s where s.company_id = company and s.owner = p_owner
      and auth.uid() = any(app.active_visual_work_supervisors(company, s.supervisor_ids))
  ) then
    raise exception 'Visual 요청 양식 수정 권한이 없습니다.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('work-request-settings:' || company::text, 0));
  select * into current_settings from public.work_request_settings where company_id = company and owner = p_owner for update;
  can_manage := app.work_manage_allowed(p_owner);
  if not can_manage and (auth.uid() = any(app.active_visual_work_supervisors(company, current_settings.supervisor_ids))) is not true then
    raise exception 'Visual 요청 양식 수정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_revision is distinct from coalesce(current_settings.revision, 0) then
    raise exception '다른 관리자가 설정을 변경했습니다. 다시 불러온 뒤 저장하세요.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories)>40 or octet_length(p_categories::text)>262144 then raise exception '분류 설정 형식을 확인하세요.'; end if;
  if exists(select 1 from jsonb_array_elements(p_categories) c group by c->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_categories) c group by trim(c->>'label') having count(*)>1) then raise exception '분류 ID 또는 이름이 중복됩니다.'; end if;
  for category in select * from jsonb_array_elements(p_categories) loop
    if jsonb_typeof(category) is distinct from 'object' or coalesce(category->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' or category->>'id'='main'
    or jsonb_typeof(category->'label') is distinct from 'string' or length(trim(category->>'label')) not between 1 and 80
    or jsonb_typeof(category->'enabled') is distinct from 'boolean' or jsonb_typeof(category->'assigneeId') is distinct from 'string'
    or jsonb_typeof(category->'fields') is distinct from 'array' or jsonb_array_length(category->'fields')>30 then raise exception '분류 이름·표시 여부·입력 항목을 확인하세요.'; end if;
    if can_manage then
      person := nullif(category->>'assigneeId', '')::uuid;
      if person is not null and not exists (
        select 1 from public.profiles p where p.id = person and p.company_id = company
          and p.status = 'active' and p.department_id = app.work_department(p_owner)
      ) then
        raise exception '해당 부서의 재직 직원만 담당자로 지정할 수 있습니다.';
      end if;
    else
      select c->>'assigneeId' into previous_assignee from jsonb_array_elements(current_settings.categories) c
      where c->>'id' = category->>'id';
      if category->>'assigneeId' is distinct from coalesce(previous_assignee, '') then
        raise exception '중간 관리자는 Visual 업무 관리 담당자만 지정할 수 있습니다.' using errcode = '42501';
      end if;
    end if;
    if exists(select 1 from jsonb_array_elements(category->'fields') f group by f->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(category->'fields') f group by trim(f->>'label') having count(*)>1) then raise exception '입력 항목 ID 또는 이름이 중복됩니다.'; end if;
    for field in select * from jsonb_array_elements(category->'fields') loop
      if jsonb_typeof(field) is distinct from 'object' or coalesce(field->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$'
      or jsonb_typeof(field->'label') is distinct from 'string' or length(trim(field->>'label')) not between 1 and 100
      or coalesce(field->>'type','') not in ('text','textarea','number','date') or jsonb_typeof(field->'required') is distinct from 'boolean'
      or jsonb_typeof(field->'placeholder') is distinct from 'string' or length(field->>'placeholder')>300 then raise exception '입력 항목 형식·필수 여부·안내 문구를 확인하세요.'; end if;
    end loop;
  end loop;
  insert into public.work_request_settings(company_id,owner,categories,updated_by) values(company,p_owner,p_categories,auth.uid())
  on conflict(company_id,owner) do update set categories=excluded.categories,revision=work_request_settings.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()
  returning revision into next_revision;
  return next_revision;
end $$;

create or replace function app.save_visual_work_request_settings(p_revision bigint, p_categories jsonb, p_supervisors uuid[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_revision bigint;
  v_company uuid := app.permission_company_id();
  v_previous uuid[];
begin
  -- The original save checks authority and revision and locks the settings row.
  v_revision := app.save_work_request_settings('design', p_revision, p_categories);
  select supervisor_ids into v_previous from public.work_request_settings where company_id = v_company and owner = 'design';
  if p_supervisors is not distinct from v_previous then return v_revision; end if;
  if not app.work_manage_allowed('design') then
    raise exception '총괄 관리자는 Visual 업무 관리 담당자만 지정할 수 있습니다.' using errcode = '42501';
  end if;
  if p_supervisors is null or cardinality(p_supervisors) = 0
    or cardinality(p_supervisors) <> (select count(distinct id) from unnest(p_supervisors) id)
    or p_supervisors is distinct from app.active_visual_work_supervisors(v_company, p_supervisors) then
    raise exception 'Visual 재직 직원 중 총괄 관리자를 한 명 이상 중복 없이 지정해 주세요.' using errcode = '22023';
  end if;
  update public.work_request_settings set supervisor_ids = p_supervisors where company_id = v_company and owner = 'design';
  return v_revision;
end $$;
