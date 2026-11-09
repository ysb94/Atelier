-- 총괄 수정 뒤 작업자가 다시 정해지면 수정 횟수를 아래 줄에서 새로 센다.
-- 기존 feedback 합계는 그대로 두고, 화면용 구간만 feedbackCycles에 남긴다.

create or replace function app.change_visual_category_work(p_request uuid,p_category text,p_revision bigint,p_action text,
  p_person uuid,p_note text,p_result_url text,p_command uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  r public.work_requests;
  flow jsonb;
  step jsonb;
  state text;
  next_state text;
  middle uuid;
  worker uuid;
  supervisors uuid[];
  supervisor uuid;
  reviewing_supervisor boolean;
  working_member boolean;
  counts jsonb;
  cycles jsonb;
  counter text;
  round_id uuid;
  result_id uuid;
  result_url text := nullif(btrim(coalesce(p_result_url,'')),'');
  note text := btrim(coalesce(p_note,''));
  next_status text;
  now_at timestamptz := clock_timestamp();
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and kind='request' and data ? 'visualCategoryWorkflow' for update;
  if not found or actor is null or not (app.work_request_read(r.id) or app.department_work_read(r.id)) then
    raise exception 'Visual 업무를 처리할 권한이 없습니다.' using errcode='42501';
  end if;
  if exists(select from public.work_request_commands where actor_id=actor and command_id=p_command and request_id=r.id) then
    return r.revision;
  end if;
  if p_command is null or r.revision is distinct from p_revision or r.status in ('draft','completed','cancelled','rejected')
    or coalesce(r.data->>'deleted','false')='true' then
    raise exception '업무가 변경되었습니다. 다시 조회해 주세요.' using errcode='40001';
  end if;

  flow := r.data->'visualCategoryWorkflow';
  perform 1 from public.work_request_settings s where s.company_id=r.company_id and s.owner='design' for share;
  supervisors := app.visual_workflow_active_supervisors(r.company_id);
  supervisor := app.visual_work_final_approver(flow,supervisors);
  reviewing_supervisor := actor=any(supervisors) and (supervisor is null or actor=supervisor);
  working_member := exists(select from public.profiles p where p.id=actor and p.company_id=r.company_id
    and p.status='active' and p.department_id=app.work_department('design'));
  next_status := r.status;

  if p_action='receipt' then
    if not reviewing_supervisor or flow->>'receivedAt' is not null then
      raise exception '이 요청의 총괄 관리자만 접수를 확인할 수 있습니다.' using errcode='42501';
    end if;
    flow := flow || jsonb_build_object('approverId',actor,'receivedAt',now_at);
    next_status := 'inProgress';
  elsif p_action='assign_supervisor' then
    if p_person is null or not p_person=any(supervisors) or not app.work_manage_allowed('design') then
      raise exception '업무 관리 담당자가 재직 총괄 관리자를 지정해 주세요.' using errcode='42501';
    end if;
    flow := flow || jsonb_build_object('approverId',p_person,'receiptVersion',r.revision+1);
  else
    step := flow->'categories'->p_category;
    if step is null or flow->>'receivedAt' is null then
      raise exception '총괄 접수가 완료된 업무 분류를 확인해 주세요.' using errcode='42501';
    end if;
    state := step->>'state';
    worker := (step->>'workerId')::uuid;
    result_id := (step->>'resultId')::uuid;
    round_id := (step->>'roundId')::uuid;
    counts := coalesce(step->'feedback','{}'::jsonb);
    cycles := step->'feedbackCycles';
    if cycles is null or jsonb_typeof(cycles) is distinct from 'array' or jsonb_array_length(cycles)=0 then
      cycles := jsonb_build_array(jsonb_build_object(
        'middle', coalesce((counts->>'middle')::int,0),
        'supervisor', coalesce((counts->>'supervisor')::int,0),
        'requester', coalesce((counts->>'requester')::int,0)));
    end if;
    select p.id into middle from jsonb_array_elements(r.data->'categoryAssignments') a
      join public.profiles p on p.id::text=a->>'assigneeId' and p.company_id=r.company_id
        and p.department_id=app.work_department('design') and p.status='active'
      where a->>'categoryId'=p_category;

    case p_action
      when 'assign_worker' then
        if actor is distinct from middle or state not in ('assignment','working') then
          raise exception '해당 분류의 중간 관리자만 작업자를 배정할 수 있습니다.' using errcode='42501';
        end if;
        if p_person is null or not exists(select from public.profiles p where p.id=p_person and p.company_id=r.company_id
          and p.department_id=app.work_department('design') and p.status='active') then
          raise exception 'Visual 재직 직원을 선택해 주세요.' using errcode='22023';
        end if;
        if worker=p_person then return r.revision; end if;
        worker := p_person;
        next_state := 'working';
      when 'submit' then
        if not working_member or actor is distinct from worker or state<>'working' then
          raise exception '이 분류에 배정된 작업자만 결과물을 제출할 수 있습니다.' using errcode='42501';
        end if;
        if (note='' and result_url is null) or length(note)>10000 or
          (result_url is not null and (length(result_url)>2048 or result_url !~ '^https?://[^[:space:]]+$')) then
          raise exception '결과 내용 또는 http(s) 링크를 확인해 주세요.' using errcode='22023';
        end if;
        result_id := p_command;
        next_state := 'middle_review';
      when 'middle_approve','middle_return' then
        if actor is distinct from middle or state<>'middle_review' then
          raise exception '해당 분류의 중간 관리자만 결과물을 검수할 수 있습니다.' using errcode='42501';
        end if;
        if p_action='middle_approve' then next_state := 'supervisor_review';
        else counter := 'middle'; next_state := 'working'; end if;
      when 'supervisor_approve','supervisor_return','supervisor_forward' then
        if not reviewing_supervisor or state<>(case when p_action='supervisor_forward' then 'supervisor_revision' else 'supervisor_review' end) then
          raise exception '해당 업무의 총괄 관리자만 처리할 수 있습니다.' using errcode='42501';
        end if;
        flow := flow || jsonb_build_object('approverId',actor);
        if p_action='supervisor_approve' then
          update app.visual_workflow_entries set shared_at=now_at
            where id=result_id and request_id=r.id and category_id=p_category and action='submit';
          if not found then raise exception '공유할 결과물이 없습니다.' using errcode='40001'; end if;
          next_state := 'requester_review';
        else
          if p_action='supervisor_return' then counter := 'supervisor'; end if;
          next_state := 'middle_revision';
        end if;
      when 'middle_forward' then
        if actor is distinct from middle or state<>'middle_revision' then
          raise exception '해당 분류의 중간 관리자만 수정 요청을 전달할 수 있습니다.' using errcode='42501';
        end if;
        if not exists(select from public.profiles p where p.id=coalesce(p_person,worker) and p.company_id=r.company_id
          and p.department_id=app.work_department('design') and p.status='active') then
          raise exception '수정할 Visual 재직 직원을 선택해 주세요.' using errcode='22023';
        end if;
        worker := coalesce(p_person,worker);
        next_state := 'working';
      when 'requester_confirm','requester_return' then
        if actor is distinct from r.requester_id or state<>'requester_review' then
          raise exception '요청자만 이 분류의 결과를 확인할 수 있습니다.' using errcode='42501';
        end if;
        if p_action='requester_confirm' then next_state := 'confirmed';
        else counter := 'requester'; next_state := 'supervisor_revision'; end if;
      else
        raise exception '처리할 작업을 확인해 주세요.' using errcode='22023';
    end case;

    if counter is not null then
      counts := jsonb_set(counts,array[counter],to_jsonb(coalesce((counts->>counter)::int,0)+1));
      cycles := jsonb_set(cycles, array[(jsonb_array_length(cycles)-1)::text, counter],
        to_jsonb(coalesce((cycles->(jsonb_array_length(cycles)-1)->>counter)::int,0)+1));
      round_id := p_command;
    end if;
    if p_action='middle_forward' and coalesce((cycles->(jsonb_array_length(cycles)-1)->>'supervisor')::int,0) > 0 then
      cycles := cycles || jsonb_build_array(jsonb_build_object('middle',0,'supervisor',0,'requester',0));
    end if;
    if counter is not null or p_action in ('supervisor_forward','middle_forward') then
      if length(note) not between 1 and 2000 then
        raise exception '수정 의견을 1~2000자로 입력해 주세요.' using errcode='22023';
      end if;
    end if;
    if p_action='submit' or counter is not null or p_action in ('supervisor_forward','middle_forward') then
      insert into app.visual_workflow_entries(id,request_id,category_id,actor_id,action,round_id,note,result_url,created_at)
      values(p_command,r.id,p_category,actor,p_action,round_id,note,case when p_action='submit' then result_url end,now_at);
    end if;
    step := step || jsonb_strip_nulls(jsonb_build_object('state',next_state,'workerId',worker,'version',r.revision+1,
      'resultId',result_id,'roundId',round_id,'feedback',counts)) || jsonb_build_object('feedbackCycles',cycles);
    flow := jsonb_set(flow,array['categories',p_category],step);
    if not exists(select from jsonb_each(flow->'categories') c where c.value->>'state'<>'confirmed') then
      next_status := 'completed';
      r.data := r.data || jsonb_build_object('completedAt',now_at);
      update public.work_request_time_entries
        set accumulated_ms=accumulated_ms+greatest(0,(extract(epoch from (now_at-mounted_at))*1000)::bigint),mounted_at=null
        where request_id=r.id and mounted_at is not null;
    elsif not exists(select from jsonb_each(flow->'categories') c where c.value->>'state' not in ('confirmed','requester_review')) then
      next_status := 'completionConfirm';
    else
      next_status := 'inProgress';
    end if;
  end if;

  update public.work_requests set status=next_status,data=jsonb_set(r.data,'{visualCategoryWorkflow}',flow),
    revision=revision+1,updated_at=now_at where id=r.id returning revision into r.revision;
  insert into public.work_request_commands(actor_id,command_id,request_id) values(actor,p_command,r.id);
  return r.revision;
end $$;
