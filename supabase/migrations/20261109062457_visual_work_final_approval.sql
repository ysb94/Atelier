-- A configured Visual supervisor signs off after the existing requester confirmation.
alter table public.work_request_settings add column supervisor_ids uuid[] not null default '{}'
  check (cardinality(supervisor_ids) <= 2);

create function app.active_visual_work_supervisors(p_company uuid, p_ids uuid[]) returns uuid[]
language sql stable set search_path = '' as $$
  select array(select p.id from unnest(p_ids) with ordinality s(id, rank)
    join public.profiles p on p.id = s.id and p.company_id = p_company and p.status = 'active'
      and p.department_id = app.work_department('design')
    order by s.rank)
$$;

create function app.visual_work_final_approver(p_approval jsonb, p_active uuid[]) returns uuid
language sql immutable set search_path = '' as $$
  select coalesce((select id from unnest(p_active) id where id::text = p_approval->>'approverId'),
    case when cardinality(p_active) = 1 then p_active[1] end)
$$;

create or replace function app.get_work_request_settings(p_owner text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_settings public.work_request_settings;
begin
  if v_company is null or p_owner is distinct from 'design' then
    raise exception '설정 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  select * into v_settings from public.work_request_settings where company_id = v_company and owner = p_owner;
  return jsonb_build_object('revision', coalesce(v_settings.revision, 0),
    'categories', coalesce(v_settings.categories, '[]'::jsonb), 'canManage', app.work_manage_allowed(p_owner),
    'supervisorIds', coalesce(v_settings.supervisor_ids, '{}'::uuid[]),
    'activeSupervisorIds', app.active_visual_work_supervisors(v_company, v_settings.supervisor_ids));
end $$;

create function app.save_visual_work_request_settings(p_revision bigint, p_categories jsonb, p_supervisors uuid[]) returns bigint
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
  if p_supervisors is null or cardinality(p_supervisors) not between 1 and 2
    or cardinality(p_supervisors) <> (select count(distinct id) from unnest(p_supervisors) id)
    or p_supervisors is distinct from app.active_visual_work_supervisors(v_company, p_supervisors) then
    raise exception 'Visual 재직 직원 중 서로 다른 총괄 관리자를 한 명 또는 두 명 지정해 주세요.' using errcode = '22023';
  end if;
  update public.work_request_settings set supervisor_ids = p_supervisors where company_id = v_company and owner = 'design';
  return v_revision;
end $$;

create function app.change_visual_work_final_approval(p_request uuid, p_revision bigint, p_action text, p_value text, p_command uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  r public.work_requests;
  v_ids uuid[];
  v_active uuid[];
  v_approver uuid;
  v_target uuid;
  v_approval jsonb;
  v_data jsonb;
  v_status text;
  v_pending boolean;
  v_self_work boolean;
  v_note text := btrim(coalesce(p_value, ''));
  v_now timestamptz := clock_timestamp();
begin
  select * into r from public.work_requests where id = p_request and company_id = v_company and owner = 'design' for update;
  if not found or v_actor is null or coalesce(r.data->>'deleted', 'false') = 'true'
    or not (app.work_request_read(r.id) or app.department_work_read(r.id)) then
    raise exception 'Visual 업무를 처리할 권한이 없습니다.' using errcode = '42501';
  end if;
  if exists(select from public.work_request_commands where actor_id = v_actor and command_id = p_command and request_id = r.id) then
    return r.revision;
  end if;
  if p_command is null or p_revision is distinct from r.revision or r.status in ('draft','completed','cancelled','rejected') then
    raise exception '업무 상태가 바뀌었습니다. 다시 조회해 주세요.' using errcode = '40001';
  end if;
  select supervisor_ids into v_ids from public.work_request_settings where company_id = v_company and owner = 'design' for share;
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'Visual 총괄 관리자를 먼저 설정해 주세요.' using errcode = '22023';
  end if;
  v_active := app.active_visual_work_supervisors(v_company, v_ids);
  v_approval := coalesce(r.data->'visualFinalApproval', '{}'::jsonb);
  v_approver := app.visual_work_final_approver(v_approval, v_active);
  v_pending := r.status = 'completionConfirm' and v_approval->>'requestedAt' is not null;
  v_data := r.data;
  v_status := r.status;

  case p_action
    when 'assign' then
      select id into v_target from unnest(v_active) id where id::text = p_value;
      if v_target is null then
        raise exception '설정된 재직 총괄 관리자에게만 배정할 수 있습니다.' using errcode = '22023';
      end if;
      if not app.work_manage_allowed('design') and not (
        v_actor = any(v_active) and (v_approver is not distinct from v_actor
          or (v_approver is null and v_pending and v_target = v_actor))
      ) then
        raise exception '이 업무의 총괄 관리자를 배정할 권한이 없습니다.' using errcode = '42501';
      end if;
      v_approval := v_approval || jsonb_build_object('approverId', v_target);
    when 'submit' then
      v_self_work := r.kind = 'internal' and r.data->>'assignee' = v_actor::text
        and r.status in ('accepted','inProgress','waiting');
      if r.requester_id <> v_actor or v_pending or not (r.status = 'completionConfirm' or coalesce(v_self_work, false)) then
        raise exception '결과를 확인할 요청자만 최종 승인을 요청할 수 있습니다.' using errcode = '42501';
      end if;
      v_status := 'completionConfirm';
      v_approval := (v_approval - array['returnedReason','returnedAt','returnedBy'])
        || jsonb_build_object('approverId', v_approver, 'requestedAt', v_now);
      if v_self_work then
        if length(v_note) > 10000 then raise exception '완료 결과는 10000자 이하로 입력하세요.' using errcode = '22023'; end if;
        v_data := v_data || jsonb_build_object('completionResult', v_note, 'completionRequestedAt', v_now);
        update public.work_request_time_entries
          set accumulated_ms = accumulated_ms + greatest(0, (extract(epoch from (v_now - mounted_at)) * 1000)::bigint), mounted_at = null
          where request_id = r.id and mounted_at is not null;
      end if;
    when 'approve', 'return' then
      if not v_pending or v_actor is distinct from v_approver then
        raise exception '이 업무에 배정된 총괄 관리자만 최종 승인·반려할 수 있습니다.' using errcode = '42501';
      end if;
      v_approval := v_approval || jsonb_build_object('approverId', v_actor);
      if p_action = 'approve' then
        v_status := 'completed';
        v_approval := v_approval || jsonb_build_object('approvedBy', v_actor, 'approvedAt', v_now);
        v_data := v_data || jsonb_build_object('completedAt', v_now);
      else
        if length(v_note) not between 1 and 1000 then
          raise exception '반려 사유를 1~1000자로 입력해 주세요.' using errcode = '22023';
        end if;
        v_status := 'inProgress';
        v_approval := (v_approval - 'requestedAt')
          || jsonb_build_object('returnedReason', v_note, 'returnedAt', v_now, 'returnedBy', v_actor);
        v_data := v_data || jsonb_build_object('completionRejectCount', coalesce((r.data->>'completionRejectCount')::int, 0) + 1);
      end if;
    else
      raise exception '최종 승인 작업을 확인해 주세요.' using errcode = '22023';
  end case;

  update public.work_requests set status = v_status, data = jsonb_set(v_data, '{visualFinalApproval}', v_approval),
    revision = revision + 1, updated_at = v_now where id = r.id returning revision into r.revision;
  insert into public.work_request_commands(actor_id, command_id, request_id) values (v_actor, p_command, r.id);
  return r.revision;
end $$;

-- All existing completion paths also pass through this guard.
create function app.guard_visual_work_final_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_approval jsonb;
begin
  if old.owner <> 'design' or old.status = new.status or old.status = 'completed' then return new; end if;
  v_approval := old.data->'visualFinalApproval';
  if new.status <> 'completed' then
    if old.status = 'completionConfirm' and v_approval->>'requestedAt' is not null then
      new.data := jsonb_set(new.data, '{visualFinalApproval}', coalesce(new.data->'visualFinalApproval', v_approval) - 'requestedAt');
    end if;
    return new;
  end if;
  select supervisor_ids into v_ids from public.work_request_settings where company_id = old.company_id and owner = 'design' for share;
  if coalesce(cardinality(v_ids), 0) = 0 then return new; end if;
  if old.status <> 'completionConfirm' or v_approval->>'requestedAt' is null or auth.uid() is null
    or app.visual_work_final_approver(v_approval, app.active_visual_work_supervisors(old.company_id, v_ids)) is distinct from auth.uid()
    or (new.data->'visualFinalApproval'->>'approvedBy') is distinct from auth.uid()::text
    or (new.data->'visualFinalApproval'->>'approvedAt') is null then
    raise exception '배정된 총괄 관리자의 최종 승인이 필요합니다. 최신 업무 화면에서 처리해 주세요.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_visual_work_final_approval before update of status on public.work_requests
  for each row execute function app.guard_visual_work_final_approval();

-- Keep the current department list, including cancellation data, and expose the Visual approval status alongside it.
do $patch$
declare
  v_definition text := pg_get_functiondef('app.list_department_work(text)'::regprocedure);
  v_field constant text := '''status'',r.status';
begin
  if strpos(v_definition, v_field) = 0 then raise exception '부서 업무 목록의 상태 정의를 찾을 수 없습니다.'; end if;
  execute replace(v_definition, v_field, v_field || $field$,'visualFinalApproval',case when r.owner='design' and r.data ? 'visualFinalApproval' then
    jsonb_build_object('approverId',r.data->'visualFinalApproval'->'approverId','requestedAt',r.data->'visualFinalApproval'->'requestedAt') end$field$);
end $patch$;

create function public.save_visual_work_request_settings(p_revision bigint, p_categories jsonb, p_supervisors uuid[]) returns bigint
language sql security invoker set search_path = '' as $$ select app.save_visual_work_request_settings(p_revision, p_categories, p_supervisors) $$;
create function public.change_visual_work_final_approval(p_request uuid, p_revision bigint, p_action text, p_value text, p_command uuid) returns bigint
language sql security invoker set search_path = '' as $$ select app.change_visual_work_final_approval(p_request, p_revision, p_action, p_value, p_command) $$;

revoke all on function app.active_visual_work_supervisors(uuid, uuid[]), app.visual_work_final_approver(jsonb, uuid[]),
  app.guard_visual_work_final_approval(), app.save_visual_work_request_settings(bigint, jsonb, uuid[]),
  app.change_visual_work_final_approval(uuid, bigint, text, text, uuid), public.save_visual_work_request_settings(bigint, jsonb, uuid[]),
  public.change_visual_work_final_approval(uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function app.save_visual_work_request_settings(bigint, jsonb, uuid[]), app.change_visual_work_final_approval(uuid, bigint, text, text, uuid),
  public.save_visual_work_request_settings(bigint, jsonb, uuid[]), public.change_visual_work_final_approval(uuid, bigint, text, text, uuid) to authenticated;
notify pgrst, 'reload schema';
