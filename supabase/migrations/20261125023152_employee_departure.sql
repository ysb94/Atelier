begin;

-- The private audit preserves the former assignee and the original permissions.
create table app.employee_departures (
  employee_id uuid primary key references public.profiles(id),
  company_id uuid not null references public.companies(id),
  command_id uuid not null unique,
  resigned_on date not null,
  processed_by uuid not null references public.profiles(id),
  processed_at timestamptz not null,
  handover jsonb not null,
  revoked jsonb not null
);
alter table app.employee_departures enable row level security;
revoke all on app.employee_departures from public, anon, authenticated;

create table app.employee_departure_handover_events (
  command_id uuid primary key,
  employee_id uuid not null references app.employee_departures(employee_id),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null,
  transferred jsonb not null
);
alter table app.employee_departure_handover_events enable row level security;
revoke all on app.employee_departure_handover_events from public, anon, authenticated;

-- The retiring person's still-open browser can receive this after their profile
-- has already stopped passing active-user checks. No personnel data is exposed.
create table public.employee_departure_signals (
  employee_id uuid primary key references public.profiles(id),
  processed_at timestamptz not null
);
alter table public.employee_departure_signals enable row level security;
revoke all on public.employee_departure_signals from public, anon, authenticated;
grant select on public.employee_departure_signals to authenticated;
create policy employee_departure_signal_self on public.employee_departure_signals for select to authenticated
  using (employee_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.employee_departure_signals;
  end if;
end;
$$;

create function app.guard_employee_departure_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.employee_departures where employee_id = old.id) then
    raise exception '퇴사 처리된 직원은 계정 정지를 일반 해제할 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prevent_departed_employee_reactivation before update of status on public.profiles
  for each row when (old.status is distinct from new.status and new.status <> 'disabled')
  execute function app.guard_employee_departure_profile();

create function app.employee_departure_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  login_session uuid;
  company uuid := app.permission_company_id();
begin
  if company is null or not app.can_manage_personnel() or not app.assignment_manager() then
    raise exception '직원 계정 관리와 권한 지정 관리 권한이 필요합니다.' using errcode = '42501';
  end if;
  begin
    login_session := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception '본인 로그인 세션을 확인해 주세요.' using errcode = '42501';
  end;
  if not exists (select 1 from auth.sessions s join auth.mfa_amr_claims m on m.session_id = s.id
      where s.id = login_session and s.user_id = actor and m.authentication_method in ('oauth', 'password')) then
    raise exception '본인 계정으로 로그인한 뒤 퇴사 처리를 진행해 주세요.' using errcode = '42501';
  end if;
  return company;
end;
$$;

-- Keep the creator in card history and transfer ongoing ownership separately.
alter table app.personal_work_cards add column handover_owner_id uuid references public.profiles(id);
create index personal_work_handover_owner on app.personal_work_cards (handover_owner_id)
  where handover_owner_id is not null and deleted_at is null and status <> 'done';

do $patch$
declare
  definition text := pg_get_functiondef('app.personal_work_action(uuid,uuid,text,integer,text,text,uuid,uuid,text)'::regprocedure);
  old_acl constant text := 'assignee_id = actor.id or created_by = actor.id or (reviewer_id = actor.id';
begin
  if strpos(definition, old_acl) = 0 or strpos(definition, 'card.created_by <> card.assignee_id') = 0 then
    raise exception '개인 업무 함수의 인계 기준을 확인해 주세요.';
  end if;
  execute replace(replace(definition, old_acl,
    'assignee_id = actor.id or coalesce(handover_owner_id, created_by) = actor.id or (reviewer_id = actor.id'),
    'card.created_by', 'coalesce(card.handover_owner_id, card.created_by)');

  definition := pg_get_functiondef('app.list_personal_work_cards()'::regprocedure);
  if strpos(definition, 'card.created_by = actor.id') = 0 or strpos(definition, $old$'creator_name', creator.display_name,$old$) = 0 then
    raise exception '개인 업무 조회 함수의 인계 기준을 확인해 주세요.';
  end if;
  execute replace(replace(replace(definition,
    'card.created_by = actor.id', 'coalesce(card.handover_owner_id, card.created_by) = actor.id'),
    $old$'creator_name', creator.display_name,$old$,
    $new$'creator_name', creator.display_name, 'owner_id', owner.id, 'owner_name', owner.display_name,$new$),
    'join public.profiles creator on creator.id = card.created_by',
    'join public.profiles creator on creator.id = card.created_by join public.profiles owner on owner.id = coalesce(card.handover_owner_id, card.created_by)');
end;
$patch$;

-- Only current assignment fields count. Message authors, reviews and completed
-- sub-tasks are retained as they were recorded.
create function app.employee_departure_request_assignment(p_data jsonb, p_employee text)
returns boolean language sql immutable set search_path = '' as $$
  with assignments as (
    select value from jsonb_array_elements(case when jsonb_typeof(p_data->'categoryAssignments') = 'array'
      then p_data->'categoryAssignments' else '[]' end)
  )
  select coalesce(p_data->>'assignee' = p_employee, false)
    or (jsonb_typeof(p_data->'collaborators') = 'array' and p_data->'collaborators' ? p_employee
      and not exists (select 1 from assignments where value->>'assigneeId' = p_employee))
    or coalesce(p_data->'visualCategoryWorkflow'->>'approverId' = p_employee, false)
    or exists (select 1 from assignments a
      where a.value->>'assigneeId' = p_employee
        and coalesce(p_data->'visualCategoryWorkflow'->'categories'->(a.value->>'categoryId')->>'state', '') not in ('approved', 'confirmed', 'completed', 'done'))
    or exists (select 1 from jsonb_each(case when jsonb_typeof(p_data->'visualCategoryWorkflow'->'categories') = 'object'
        then p_data->'visualCategoryWorkflow'->'categories' else '{}' end) c
      where c.value->>'workerId' = p_employee and coalesce(c.value->>'state', '') not in ('approved', 'confirmed', 'completed', 'done'));
$$;

create function app.employee_departure_request_data(p_data jsonb, p_employee text, p_successor text, p_revision bigint)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  next_data jsonb := p_data;
  flow jsonb := p_data->'visualCategoryWorkflow';
  item record;
begin
  if next_data->>'assignee' = p_employee then
    next_data := jsonb_set(next_data, '{assignee}', to_jsonb(p_successor));
  end if;
  if jsonb_typeof(next_data->'collaborators') = 'array' and next_data->'collaborators' ? p_employee then
    next_data := jsonb_set(next_data, '{collaborators}', (
      select jsonb_agg(v order by first_at) from (
        select case when value = p_employee then p_successor else value end v, min(ord) first_at
        from jsonb_array_elements_text(next_data->'collaborators') with ordinality a(value, ord) group by 1
      ) kept));
  end if;
  if jsonb_typeof(next_data->'categoryAssignments') = 'array' then
    next_data := jsonb_set(next_data, '{categoryAssignments}', coalesce((
      select jsonb_agg(case when value->>'assigneeId' = p_employee
        and coalesce(flow->'categories'->(value->>'categoryId')->>'state', '') not in ('approved','confirmed','completed','done')
        then jsonb_set(value, '{assigneeId}', to_jsonb(p_successor)) else value end order by ord)
      from jsonb_array_elements(next_data->'categoryAssignments') with ordinality a(value, ord)), '[]'));
  end if;
  if flow->>'approverId' = p_employee then
    flow := flow || jsonb_build_object('approverId', p_successor, 'receiptVersion', p_revision);
  end if;
  for item in select key, value from jsonb_each(case when jsonb_typeof(flow->'categories') = 'object' then flow->'categories' else '{}' end) loop
    if item.value->>'workerId' = p_employee and coalesce(item.value->>'state', '') not in ('approved','confirmed','completed','done') then
      flow := jsonb_set(flow, array['categories', item.key],
        item.value || jsonb_build_object('workerId', p_successor, 'version', p_revision));
    end if;
  end loop;
  return case when flow is null then next_data else jsonb_set(next_data, '{visualCategoryWorkflow}', flow) end;
end;
$$;

create function app.employee_departure_work(p_company uuid, p_employee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'personal', coalesce((select jsonb_agg(jsonb_build_array(id, revision) order by id)
      from app.personal_work_cards where company_id = p_company and deleted_at is null and status <> 'done'
        and p_employee in (coalesce(handover_owner_id, created_by), assignee_id, reviewer_id)), '[]'),
    'requests', coalesce((select jsonb_agg(jsonb_build_array(id, revision, owner) order by id)
      from public.work_requests where company_id = p_company and status not in ('draft', 'completed','cancelled','rejected')
        and coalesce(data->>'deleted', 'false') <> 'true' and app.employee_departure_request_assignment(data, p_employee::text)), '[]'),
    'sent', coalesce((select jsonb_agg(jsonb_build_array(id, revision) order by id)
      from public.work_requests where company_id = p_company and requester_id = p_employee
        and status not in ('completed','cancelled','rejected') and coalesce(data->>'deleted','false') <> 'true'), '[]'),
    'settings', coalesce((select jsonb_agg(jsonb_build_array(owner, revision) order by owner)
      from public.work_request_settings where company_id = p_company and (p_employee = any(supervisor_ids)
        or exists (select 1 from jsonb_array_elements(categories) c where c->>'assigneeId' = p_employee::text))), '[]'),
    'approvals', coalesce((select jsonb_agg(jsonb_build_array(department_id, request_type, updated_at) order by department_id, request_type)
      from public.department_request_approvers where company_id = p_company and p_employee in (approver_id, substitute_id)), '[]')
  );
$$;

create function app.preview_employee_departure(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  company uuid := app.employee_departure_actor();
  employee public.profiles%rowtype;
  completed app.employee_departures%rowtype;
  work jsonb;
begin
  select * into employee from public.profiles where id = p_employee and company_id = company and id <> auth.uid();
  if not found or employee.status not in ('active','disabled') then
    raise exception '같은 회사의 직원을 선택해 주세요.' using errcode = '42501';
  end if;
  select * into completed from app.employee_departures where employee_id = p_employee;
  work := app.employee_departure_work(company, p_employee);
  return jsonb_build_object('version', md5(work::text),
    'processedAt', completed.processed_at,
    'resignedOn', (select resigned_on from public.employee_roster where profile_id = p_employee and company_id = company),
    'personalCount', jsonb_array_length(work->'personal'), 'sentCount', jsonb_array_length(work->'sent'),
    'approvalCount', jsonb_array_length(work->'approvals'),
    'canHandoverApprovals', app.can_edit_org_assignment(),
    'requestGroups', coalesce((select jsonb_agg(jsonb_build_object('owner',owner,'departmentId',app.work_department(owner),
      'count',count,'settingsCount',settings_count) order by owner) from (
        select owner, count(*) filter (where is_request) as count, count(*) filter (where not is_request) as settings_count
        from (select x->>2 owner, true is_request from jsonb_array_elements(work->'requests') x
          union all select x->>0 owner, false from jsonb_array_elements(work->'settings') x) groups group by owner
      ) counts), '[]'));
end;
$$;

create function app.transfer_employee_departure_work(
  p_company uuid, p_employee uuid, p_work_successor uuid, p_approval_successor uuid,
  p_request_successors jsonb, p_version text, p_command uuid, p_event_time timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  company uuid := p_company;
  actor uuid := auth.uid();
  group_choice record;
  work jsonb;
  card app.personal_work_cards%rowtype;
  next_assignee uuid;
  next_reviewer uuid;
  close_timer boolean;
  event_time timestamptz := p_event_time;
begin
  if jsonb_typeof(p_request_successors) is distinct from 'object' then
    raise exception '작업 요청 후임자 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  perform id from public.profiles where company_id = company and (id in (p_employee, p_work_successor, p_approval_successor)
    or id::text in (select value from jsonb_each_text(p_request_successors)))
    order by id for update;
  -- Lock the current rows before checking the preview. A retry must use the new
  -- revision if an editor changed the assignment while the dialog was open.
  work := app.employee_departure_work(company, p_employee);
  perform id from app.personal_work_cards where id in (select (x->>0)::uuid from jsonb_array_elements(work->'personal') x) order by id for update;
  perform id from public.work_requests where id in
    (select (x->>0)::uuid from jsonb_array_elements(work->'requests' || work->'sent') x) order by id for update;
  perform owner from public.work_request_settings where company_id = company and owner in
    (select x->>0 from jsonb_array_elements(work->'settings') x) order by owner for update;
  perform department_id from public.department_request_approvers where company_id = company
    and p_employee in (approver_id, substitute_id) order by department_id, request_type for update;
  work := app.employee_departure_work(company, p_employee);
  if p_version is distinct from md5(work::text) then
    raise exception '인계할 업무 또는 승인 담당이 바뀌었습니다. 최신 내용을 다시 확인해 주세요.' using errcode = '40001';
  end if;
  if p_work_successor is not null then
    if jsonb_array_length(work->'personal') + jsonb_array_length(work->'sent') = 0 then
      raise exception '인계할 업무가 없습니다. 목록을 다시 확인해 주세요.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles where id = p_work_successor and id <> p_employee
        and company_id = company and status = 'active') then
      raise exception '업무를 인계받을 재직 직원을 선택해 주세요.' using errcode = '22023';
    end if;
  end if;
  for group_choice in select key as owner, value as successor from jsonb_each_text(p_request_successors) loop
    if not exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id and d.is_active
        where p.id::text = group_choice.successor and p.id <> p_employee and p.company_id = company
        and p.status = 'active' and p.department_id = app.work_department(group_choice.owner))
      or not (exists (select 1 from jsonb_array_elements(work->'requests') x where x->>2 = group_choice.owner)
        or exists (select 1 from jsonb_array_elements(work->'settings') x where x->>0 = group_choice.owner)) then
      raise exception '작업 요청이 남아 있는 담당 부서의 재직 직원을 선택해 주세요.' using errcode = '22023';
    end if;
  end loop;
  if p_approval_successor is not null then
    if jsonb_array_length(work->'approvals') = 0 then
      raise exception '인계할 승인 담당이 없습니다. 목록을 다시 확인해 주세요.' using errcode = '22023';
    end if;
    if not app.can_edit_org_assignment() then
      raise exception '승인자 지정 권한이 있는 담당자가 퇴사 처리해야 합니다.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = p_approval_successor and id <> p_employee
        and company_id = company and status = 'active') then
      raise exception '승인 담당을 인계받을 재직 직원을 선택해 주세요.' using errcode = '22023';
    end if;
  end if;

  for card in select * from app.personal_work_cards where id in
    (select (x->>0)::uuid from jsonb_array_elements(work->'personal') x)
    and (p_work_successor is not null or (status = 'doing' and assignee_id = p_employee)) order by id loop
    next_assignee := case when card.assignee_id = p_employee then coalesce(p_work_successor,card.assignee_id) else card.assignee_id end;
    next_reviewer := case when card.reviewer_id = p_employee then coalesce(p_work_successor,card.reviewer_id) else card.reviewer_id end;
    if next_assignee = next_reviewer then
      if card.status = 'feedback' then
        raise exception '피드백 대기 카드의 작업자와 담당자가 겹칩니다. 다른 업무 후임을 선택해 주세요.' using errcode = '22023';
      end if;
      next_reviewer := null;
    end if;
    close_timer := card.status = 'doing' and card.assignee_id = p_employee;
    update app.personal_work_cards set assignee_id = next_assignee, reviewer_id = next_reviewer,
      handover_owner_id = case when coalesce(card.handover_owner_id, card.created_by) = p_employee
        then coalesce(p_work_successor,card.handover_owner_id) else card.handover_owner_id end,
      status = case when close_timer then 'todo' else card.status end,
      events = card.events || case when close_timer then jsonb_build_array(jsonb_build_object(
        'kind','paused','round',card.round,'actor_id',actor,'at',event_time,'note','퇴사에 따른 업무 인계')) else '[]'::jsonb end,
      revision = card.revision + 1, updated_at = event_time, last_command = p_command, last_actor = actor
    where id = card.id;

    -- The additive notification migration can be released independently.
    if card.status = 'feedback' and p_work_successor is not null and to_regclass('public.personal_work_feedback_notices') is not null then
      update public.personal_work_feedback_notices set resolved_at = event_time
      where card_id = card.id and resolved_at is null;
      insert into public.personal_work_feedback_notices
        (id, company_id, recipient_id, card_id, card_revision, round, title, note, requester_name, created_at)
      select gen_random_uuid(), company, next_reviewer, card.id, card.revision + 1, card.round, card.title,
        card.events->-1->>'note', p.display_name, event_time
      from public.profiles p where p.id = card.assignee_id and next_reviewer is not null;
    end if;
  end loop;

  update public.work_request_settings s set
    supervisor_ids = array(select id from (select case when id = p_employee then (p_request_successors->>s.owner)::uuid else id end id,
      min(ord) first_at from unnest(s.supervisor_ids) with ordinality a(id, ord) group by 1) ranked order by first_at),
    categories = coalesce((select jsonb_agg(case when value->>'assigneeId' = p_employee::text
      then jsonb_set(value,'{assigneeId}',to_jsonb(p_request_successors->>s.owner)) else value end order by ord)
      from jsonb_array_elements(s.categories) with ordinality a(value, ord)), '[]'),
    revision = s.revision + 1, updated_by = actor, updated_at = event_time
  where p_request_successors ? s.owner and s.company_id = company and s.owner in (select x->>0 from jsonb_array_elements(work->'settings') x);

  update public.work_requests w set data = app.employee_departure_request_data(w.data, p_employee::text, p_request_successors->>w.owner, w.revision + 1),
    revision = w.revision + 1, updated_at = event_time
  where p_request_successors ? w.owner and w.id in (select (x->>0)::uuid from jsonb_array_elements(work->'requests') x);

  update public.work_requests w set requester_id = p_work_successor,
    -- Notice routing depends on the current requester; changing the receipt
    -- version refreshes the Visual queue while preserving the request content.
    data = case when jsonb_typeof(w.data->'visualCategoryWorkflow') = 'object' then
      jsonb_set(w.data,'{visualCategoryWorkflow,receiptVersion}',to_jsonb(w.revision+1)) else w.data end,
    revision = w.revision + 1, updated_at = event_time
  where p_work_successor is not null and w.id in (select (x->>0)::uuid from jsonb_array_elements(work->'sent') x);

  update public.work_request_time_entries t set
    accumulated_ms = t.accumulated_ms + greatest(0, (extract(epoch from (event_time - t.mounted_at)) * 1000)::bigint), mounted_at = null
  where t.profile_id = p_employee and t.mounted_at is not null
    and exists (select 1 from public.work_requests w where w.id = t.request_id and w.company_id = company);

  update public.department_request_approvers a set
    approver_id = case when a.approver_id = p_employee then p_approval_successor else a.approver_id end,
    substitute_id = case when a.approver_id = p_employee and a.substitute_id = p_approval_successor
      or a.substitute_id = p_employee and a.approver_id = p_approval_successor then null
      when a.substitute_id = p_employee then p_approval_successor else a.substitute_id end,
    updated_by = actor, updated_at = event_time
  where p_approval_successor is not null and a.company_id = company and p_employee in (a.approver_id, a.substitute_id);

  return work;
end;
$$;

create function app.confirm_employee_departure(
  p_employee uuid, p_resigned_on date, p_work_successor uuid, p_approval_successor uuid,
  p_version text, p_command uuid, p_request_successors jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  company uuid := app.employee_departure_actor();
  actor uuid := auth.uid();
  employee public.profiles%rowtype;
  completed app.employee_departures%rowtype;
  work jsonb;
  revoked jsonb;
  event_time timestamptz;
begin
  if p_employee is null or p_employee = actor or p_command is null or p_resigned_on is null
    or p_resigned_on < date '1950-01-01' then
    raise exception '본인을 제외한 직원과 퇴사일을 선택해 주세요.' using errcode = '22023';
  end if;
  -- Use the same lock as permission designation and verify the caller again after waiting.
  perform pg_advisory_xact_lock(hashtextextended(company::text, 0));
  perform app.employee_departure_actor();
  select * into employee from public.profiles where id = p_employee and company_id = company for update;
  if not found or employee.status not in ('active','disabled') then
    raise exception '같은 회사의 직원을 선택해 주세요.' using errcode = '42501';
  end if;
  select * into completed from app.employee_departures where employee_id = p_employee;
  if found then
    if completed.command_id = p_command and completed.processed_by = actor then
      return jsonb_build_object('processedAt', completed.processed_at, 'resignedOn', completed.resigned_on);
    end if;
    raise exception '이미 퇴사 처리가 완료되었습니다. 목록을 새로 불러와 주세요.' using errcode = '40001';
  end if;
  if employee.is_admin and not exists (select 1 from public.profiles where id = actor and is_admin and status = 'active') then
    raise exception '관리자 계정은 관리자 권한을 가진 담당자가 퇴사 처리해야 합니다.' using errcode = '42501';
  end if;
  if employee.is_admin and not exists (select 1 from public.profiles where company_id = company and id <> p_employee and is_admin and status = 'active') then
    raise exception '다른 시스템 관리자를 먼저 지정해 주세요.' using errcode = '42501';
  end if;
  if employee.hire_date is not null and p_resigned_on < employee.hire_date then
    raise exception '퇴사일은 입사일 이후여야 합니다.' using errcode = '22023';
  end if;
  event_time := clock_timestamp();
  work := app.transfer_employee_departure_work(company,p_employee,p_work_successor,p_approval_successor,p_request_successors,p_version,p_command,event_time);

  select jsonb_build_object('admin', employee.is_admin,
    'brandMemberships', coalesce((select jsonb_agg(to_jsonb(b)) from public.brand_members b where b.profile_id = p_employee), '[]'),
    'capabilities', coalesce((select jsonb_agg(to_jsonb(c)) from public.profile_capabilities c where c.profile_id = p_employee), '[]'),
    'workforceContacts', coalesce((select jsonb_agg(w.department_id) from public.department_workforce_policies w
      where w.company_id = company and p_employee = any(w.contact_ids)), '[]')) into revoked;
  with removed as (
    delete from public.permission_grants where company_id = company and profile_id = p_employee returning *
  ) insert into public.permission_grant_events (company_id, actor_id, profile_id, permission, scope_kind, scope_id, enabled)
    select company_id, actor, profile_id, permission, scope_kind, scope_id, false from removed;
  delete from public.brand_members where profile_id = p_employee;
  delete from public.profile_capabilities where profile_id = p_employee;
  delete from public.access_ip_reviewers where profile_id = p_employee;
  delete from public.impersonation_operators where profile_id = p_employee;
  update public.impersonation_events set ended_at = greatest(started_at, event_time)
    where company_id = company and ended_at is null and p_employee in (operator_id, target_id);
  delete from public.china_work_assignees where company_id = company and profile_id = p_employee;
  update public.department_workforce_policies set contact_ids = array_remove(contact_ids,p_employee),
    version = version + 1, updated_by = actor, updated_at = event_time
    where company_id = company and p_employee = any(contact_ids);

  insert into public.employee_roster (profile_id, company_id, resigned_on) values (p_employee, company, p_resigned_on)
    on conflict (profile_id) do update set resigned_on = excluded.resigned_on where employee_roster.company_id = company;
  if not found then raise exception '직원 명부의 회사를 확인해 주세요.' using errcode = '42501'; end if;
  update public.profiles set status = 'disabled', is_admin = false where id = p_employee and company_id = company;

  -- Ban future logins and invalidate refresh credentials of all devices in this
  -- transaction. Existing app permission checks also reject the disabled profile.
  update auth.users set banned_until = greatest(banned_until, event_time + interval '100 years') where id = p_employee;
  if not found then raise exception '직원의 로그인 계정을 확인할 수 없습니다.' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = p_employee;
  delete from auth.refresh_tokens where user_id = p_employee::text;

  insert into app.employee_departures (employee_id, company_id, command_id, resigned_on, processed_by, processed_at, handover, revoked)
    values (p_employee, company, p_command, p_resigned_on, actor, event_time,
      work || jsonb_build_object('workSuccessor',p_work_successor,'requestSuccessors',p_request_successors,'approvalSuccessor',p_approval_successor), revoked);
  insert into public.employee_departure_signals (employee_id, processed_at) values (p_employee, event_time);
  return jsonb_build_object('processedAt', event_time, 'resignedOn', p_resigned_on);
end;
$$;

create function app.handover_departed_employee_work(
  p_employee uuid, p_work_successor uuid, p_approval_successor uuid, p_version text, p_command uuid,
  p_request_successors jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  company uuid := app.employee_departure_actor();
  actor uuid := auth.uid();
  completed app.employee_departures%rowtype;
  work jsonb;
  event_time timestamptz;
begin
  if p_command is null or (p_work_successor is null and p_approval_successor is null and p_request_successors = '{}') then
    raise exception '인계받을 후임자를 한 명 이상 선택해 주세요.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(company::text, 0));
  perform app.employee_departure_actor();
  select * into completed from app.employee_departures where employee_id = p_employee and company_id = company for update;
  if not found then raise exception '퇴사 처리된 직원을 선택해 주세요.' using errcode = '42501'; end if;
  if exists (select 1 from app.employee_departure_handover_events where command_id = p_command
      and employee_id = p_employee and actor_id = actor) then
    return app.preview_employee_departure(p_employee);
  end if;
  event_time := clock_timestamp();
  work := app.transfer_employee_departure_work(company,p_employee,p_work_successor,p_approval_successor,p_request_successors,p_version,p_command,event_time);
  insert into app.employee_departure_handover_events (command_id,employee_id,actor_id,created_at,transferred)
    values (p_command,p_employee,actor,event_time,jsonb_build_object(
      'personal',case when p_work_successor is not null then work->'personal' end,
      'sent',case when p_work_successor is not null then work->'sent' end,
      'requests',coalesce((select jsonb_agg(x) from jsonb_array_elements(work->'requests') x where p_request_successors ? (x->>2)), '[]'),
      'settings',coalesce((select jsonb_agg(x) from jsonb_array_elements(work->'settings') x where p_request_successors ? (x->>0)), '[]'),
      'approvals',case when p_approval_successor is not null then work->'approvals' end,
      'workSuccessor',p_work_successor,'requestSuccessors',p_request_successors,'approvalSuccessor',p_approval_successor));
  return app.preview_employee_departure(p_employee);
end;
$$;

create function app.list_employee_departures() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('employeeId',d.employee_id,'resignedOn',d.resigned_on)), '[]')
    from app.employee_departures d where d.company_id = (select app.permission_company_id())
      and (select app.can_manage_personnel());
$$;

create function public.preview_employee_departure(p_employee uuid) returns jsonb
language sql stable set search_path = '' as $$ select app.preview_employee_departure(p_employee); $$;
create function public.confirm_employee_departure(p_employee uuid, p_resigned_on date, p_work_successor uuid,
  p_approval_successor uuid, p_version text, p_command uuid, p_request_successors jsonb default '{}') returns jsonb
language sql set search_path = '' as $$
  select app.confirm_employee_departure(p_employee,p_resigned_on,p_work_successor,p_approval_successor,p_version,p_command,p_request_successors);
$$;
create function public.list_employee_departures() returns jsonb
language sql stable set search_path = '' as $$ select app.list_employee_departures(); $$;
create function public.handover_departed_employee_work(p_employee uuid, p_work_successor uuid,
  p_approval_successor uuid, p_version text, p_command uuid, p_request_successors jsonb default '{}') returns jsonb
language sql set search_path = '' as $$
  select app.handover_departed_employee_work(p_employee,p_work_successor,p_approval_successor,p_version,p_command,p_request_successors);
$$;

revoke all on function app.guard_employee_departure_profile(), app.employee_departure_actor(),
  app.transfer_employee_departure_work(uuid,uuid,uuid,uuid,jsonb,text,uuid,timestamptz),
  app.employee_departure_work(uuid,uuid), app.employee_departure_request_assignment(jsonb,text),
  app.employee_departure_request_data(jsonb,text,text,bigint) from public, anon, authenticated;
revoke all on function app.preview_employee_departure(uuid), app.confirm_employee_departure(uuid,date,uuid,uuid,text,uuid,jsonb),
  app.list_employee_departures(), public.preview_employee_departure(uuid),
  public.confirm_employee_departure(uuid,date,uuid,uuid,text,uuid,jsonb), public.list_employee_departures() from public, anon, authenticated;
grant execute on function app.preview_employee_departure(uuid), app.confirm_employee_departure(uuid,date,uuid,uuid,text,uuid,jsonb),
  app.list_employee_departures(), public.preview_employee_departure(uuid),
  public.confirm_employee_departure(uuid,date,uuid,uuid,text,uuid,jsonb), public.list_employee_departures() to authenticated;
revoke all on function app.handover_departed_employee_work(uuid,uuid,uuid,text,uuid,jsonb),
  public.handover_departed_employee_work(uuid,uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function app.handover_departed_employee_work(uuid,uuid,uuid,text,uuid,jsonb),
  public.handover_departed_employee_work(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
