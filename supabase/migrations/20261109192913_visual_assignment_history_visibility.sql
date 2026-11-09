-- Store review counters privately because the work request row is readable through RLS.
create table app.visual_workflow_feedback (
  request_id uuid not null references public.work_requests(id) on delete cascade,
  category_id text not null,
  totals jsonb not null,
  assignments jsonb not null,
  primary key (request_id,category_id)
);
alter table app.visual_workflow_feedback enable row level security;
revoke all on app.visual_workflow_feedback from public,anon,authenticated;

alter table app.visual_workflow_entries add column assignment_id uuid;
alter table app.visual_workflow_entries drop constraint visual_workflow_entries_action_check,
  add constraint visual_workflow_entries_action_check check (action in (
    'submit','middle_return','supervisor_return','requester_return','supervisor_forward','middle_forward','assign_worker'
  ));

-- Only review metadata moves. Existing request revisions, timestamps and notices are kept.
lock table public.work_requests in share row exclusive mode;
insert into app.visual_workflow_feedback(request_id,category_id,totals,assignments)
select r.id,c.key,coalesce(c.value->'feedback','{}'::jsonb),
  case when jsonb_typeof(c.value->'feedbackCycles')='array' and c.value->'feedbackCycles'<>'[]'::jsonb
    then c.value->'feedbackCycles'
    else jsonb_build_array(coalesce(c.value->'feedback','{}'::jsonb)) end
from public.work_requests r cross join lateral jsonb_each(r.data->'visualCategoryWorkflow'->'categories') c
where r.owner='design' and c.value ?| array['feedback','feedbackCycles'];

do $move$
begin
  if exists(select from app.visual_workflow_feedback) then
    -- The moved fields are bookkeeping and must not produce workflow events.
    alter table public.work_requests disable trigger sync_visual_workflow_notices;
    alter table public.work_requests disable trigger apply_work_request_categories;
    update public.work_requests r set data=jsonb_set(r.data,'{visualCategoryWorkflow,categories}',(
      select jsonb_object_agg(c.key,c.value-'feedback'-'feedbackCycles')
      from jsonb_each(r.data->'visualCategoryWorkflow'->'categories') c
    ))
    where exists(select from app.visual_workflow_feedback h where h.request_id=r.id);
    alter table public.work_requests enable trigger apply_work_request_categories;
    alter table public.work_requests enable trigger sync_visual_workflow_notices;
  end if;
end $move$;

CREATE OR REPLACE FUNCTION app.change_visual_category_work(p_request uuid, p_category text, p_revision bigint, p_action text, p_person uuid, p_note text, p_result_url text, p_command uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  previous_worker uuid;
  cycle_id uuid;
  counter text;
  round_id uuid;
  result_id uuid;
  result_url text := nullif(btrim(coalesce(p_result_url,'')),'');
  note text := btrim(coalesce(p_note,''));
  next_status text;
  now_at timestamptz := clock_timestamp();
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and kind='request'
    and (data ? 'visualCategoryWorkflow' or p_action in ('receipt','assign_supervisor')) for update;
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
  if flow is null and to_regprocedure('app.visual_workflow_for_request(public.work_requests)') is not null then
    flow := app.visual_workflow_for_request(r);
  end if;
  if flow is null then
    raise exception '총괄 접수가 가능한 Visual 요청을 확인해 주세요.' using errcode='42501';
  end if;
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
    previous_worker := worker;
    result_id := (step->>'resultId')::uuid;
    round_id := (step->>'roundId')::uuid;
    select h.totals,h.assignments into counts,cycles from app.visual_workflow_feedback h
      where h.request_id=r.id and h.category_id=p_category;
    counts := coalesce(counts,'{}'::jsonb);
    cycles := coalesce(cycles,'[]'::jsonb);
    if cycles='[]'::jsonb and worker is not null then
      cycles := jsonb_build_array(jsonb_build_object('middle',0,'reason','legacy'));
    end if;
    cycle_id := (cycles->-1->>'id')::uuid;
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
      cycles := jsonb_set(cycles,array['-1',counter],to_jsonb(case when counter='middle'
        then coalesce((cycles->-1->>'middle')::int,0)+1 else (counts->>counter)::int end));
      round_id := p_command;
    end if;
    if counter is not null or p_action in ('supervisor_forward','middle_forward') then
      if length(note) not between 1 and 2000 then
        raise exception '수정 의견을 1~2000자로 입력해 주세요.' using errcode='22023';
      end if;
    elsif p_action='assign_worker' and length(note)>2000 then
      raise exception '작업 지시는 2000자까지 입력할 수 있습니다.' using errcode='22023';
    end if;

    if p_action in ('assign_worker','middle_forward') then
      cycle_id := p_command;
      cycles := cycles || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id',cycle_id,'workerId',worker,'assignedAt',now_at,'middle',0,
        'reason',case when p_action='middle_forward' then 'review' when previous_worker is not null then 'handoff' else 'initial' end,
        'previousWorkerId',case when previous_worker is distinct from worker then previous_worker end,
        'sourceResultId',result_id,
        'supervisor',case when p_action='middle_forward' then coalesce((counts->>'supervisor')::int,0) end
      )));
    elsif cycle_id is null and worker is not null then
      -- Historical counts can be retained without guessing who owned earlier segments.
      cycle_id := gen_random_uuid();
      cycles := jsonb_set(cycles,array['-1'],(cycles->-1)||jsonb_build_object('id',cycle_id,'reason','legacy'));
    end if;

    insert into app.visual_workflow_feedback(request_id,category_id,totals,assignments)
      values(r.id,p_category,counts,cycles) on conflict(request_id,category_id) do update
      set totals=excluded.totals, assignments=excluded.assignments;

    if p_action='submit' or counter is not null or p_action in ('supervisor_forward','middle_forward')
       or (p_action='assign_worker' and note<>'') then
      insert into app.visual_workflow_entries(id,request_id,category_id,actor_id,action,round_id,note,result_url,created_at,assignment_id)
      values(p_command,r.id,p_category,actor,p_action,round_id,note,case when p_action='submit' then result_url end,now_at,cycle_id);
    end if;
    step := step || jsonb_strip_nulls(jsonb_build_object('state',next_state,'workerId',worker,'version',r.revision+1,
      'resultId',result_id,'roundId',round_id));
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
end $function$;

-- Use the same category and active-account checks for history and comments.
create function app.visual_workflow_feedback_role(r public.work_requests,p_category text) returns text
language sql stable set search_path='' as $$
  select case
    when app.work_manage_allowed('design') or (me.department_id=app.work_department('design') and (
      me.id=app.visual_work_final_approver(r.data->'visualCategoryWorkflow',app.visual_workflow_active_supervisors(r.company_id))
      or exists(select from jsonb_array_elements(r.data->'categoryAssignments') a
        where a->>'categoryId'=p_category and a->>'assigneeId'=me.id::text)
    )) then 'manager'
    when r.requester_id=me.id then 'requester'
    when me.department_id=app.work_department('design')
      and r.data->'visualCategoryWorkflow'->'categories'->p_category->>'workerId'=me.id::text then 'worker'
  end
  from public.profiles me where me.id=auth.uid() and me.company_id=r.company_id and me.status='active'
$$;

create function app.get_visual_workflow_review(p_request uuid,p_category text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  r public.work_requests;
  view_role text;
  cycle jsonb;
  assignments jsonb;
  current_id uuid;
  result jsonb;
  handoff jsonb;
  entries jsonb;
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and status<>'draft' and coalesce(data->>'deleted','false')<>'true'
    and (data->'visualCategoryWorkflow'->'categories') ? p_category;
  if not found then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;
  view_role := app.visual_workflow_feedback_role(r,p_category);
  if view_role is null then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;

  if view_role='requester' then
    select jsonb_build_object('id',e.id,'action','submit','note',e.note,'resultUrl',e.result_url,
      'createdAt',e.created_at,'sharedAt',e.shared_at) into result
    from app.visual_workflow_entries e where e.request_id=r.id and e.category_id=p_category
      and e.action='submit' and e.shared_at is not null order by e.shared_at desc,e.id desc limit 1;
    return jsonb_build_object('role',view_role,'result',result,'entries','[]'::jsonb,'assignments','[]'::jsonb);
  end if;

  select h.assignments into assignments from app.visual_workflow_feedback h
    where h.request_id=r.id and h.category_id=p_category;
  cycle := assignments->-1;
  current_id := (cycle->>'id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,'resultUrl',e.result_url,
    'roundId',e.round_id,'createdAt',e.created_at,'sharedAt',e.shared_at,'assignmentId',e.assignment_id,
    'actorName',p.display_name) order by e.created_at desc,e.id desc),'[]'::jsonb)
    into entries
  from app.visual_workflow_entries e left join public.profiles p on p.id=e.actor_id and p.company_id=r.company_id
  where e.request_id=r.id and e.category_id=p_category and (
    view_role='manager' or (
      e.assignment_id is not distinct from current_id and (
        (e.action='submit' and e.actor_id=actor)
        or (current_id is not null and e.action in ('assign_worker','middle_return','middle_forward'))
        or (current_id is null and e.action='middle_return' and actor=(
          select submission.actor_id from app.visual_workflow_entries submission
          where submission.request_id=r.id and submission.category_id=p_category and submission.action='submit'
            and submission.created_at<=e.created_at
          order by submission.created_at desc,submission.id desc limit 1
        ))
      )
    )
  );

  if view_role='manager' then
    select coalesce(jsonb_agg(a.value||jsonb_build_object('workerName',p.display_name) order by a.ordinality),'[]'::jsonb)
    into assignments from jsonb_array_elements(coalesce(assignments,'[]'::jsonb)) with ordinality a(value,ordinality)
      left join public.profiles p on p.id::text=a.value->>'workerId' and p.company_id=r.company_id;
  else
    select jsonb_build_object('id',e.id,'action','submit','note',e.note,'resultUrl',e.result_url,
      'createdAt',e.created_at,'actorName',p.display_name) into handoff
    from app.visual_workflow_entries e left join public.profiles p on p.id=e.actor_id and p.company_id=r.company_id
    where e.request_id=r.id and e.category_id=p_category and e.action='submit' and e.id=(cycle->>'sourceResultId')::uuid;
    assignments := jsonb_build_array(jsonb_build_object('middle',(
      select count(*) from jsonb_array_elements(entries) item where item->>'action'='middle_return'
    )));
  end if;
  return jsonb_build_object('role',view_role,'result',null,'handoff',handoff,'entries',entries,'assignments',assignments);
end $$;

-- Older clients can still read an array with the same permission boundary.
create or replace function app.list_visual_workflow_entries(p_request uuid,p_category text) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when payload->>'role'='requester' and payload->>'result' is not null
    then jsonb_build_array(payload->'result') else payload->'entries' end
  from app.get_visual_workflow_review(p_request,p_category) payload
$$;

create function public.get_visual_workflow_review(p_request uuid,p_category text) returns jsonb
language sql stable set search_path='' as $$
  select app.get_visual_workflow_review(p_request,p_category)
$$;

-- New workflow feedback is exchanged through review actions. Legacy comment threads retain their prior scope.
do $discussion$
declare
  definition text := pg_get_functiondef('app.visual_work_category_discussion_allowed(uuid,text)'::regprocedure);
  boundary constant text := 'and (r.requester_id = me.id or app.work_manage_allowed(r.owner)';
  ending constant text := $clause$jsonb_build_object('category',p_category,'employee',me.id::text), true))$clause$;
begin
  if strpos(definition,boundary)=0 or strpos(definition,ending)=0 then
    raise exception '기존 Visual 댓글 권한 정의를 확인해 주세요.';
  end if;
  definition := replace(definition,boundary,$clause$and (case when (r.data->'visualCategoryWorkflow'->'categories') ? p_category
        then app.visual_workflow_feedback_role(r,p_category)='manager'
        else (r.requester_id = me.id or app.work_manage_allowed(r.owner)$clause$);
  execute replace(definition,ending,ending || ' end)');
end $discussion$;

revoke all on function app.visual_workflow_feedback_role(public.work_requests,text) from public,anon,authenticated;
revoke all on function app.get_visual_workflow_review(uuid,text),public.get_visual_workflow_review(uuid,text) from public,anon,authenticated;
grant execute on function app.get_visual_workflow_review(uuid,text),public.get_visual_workflow_review(uuid,text) to authenticated;
notify pgrst,'reload schema';
