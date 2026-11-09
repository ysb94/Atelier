-- Review rounds reuse the private feedback and entry tables. Existing rows remain untouched.
-- Existing comments stay internal in a category workflow. New shared comments and result files have distinct access.
alter table app.visual_work_category_comments add column audience text not null default 'legacy'
  check (audience in ('legacy','shared','result'));

alter table app.visual_workflow_entries drop constraint visual_workflow_entries_action_check,
  add constraint visual_workflow_entries_action_check check (action in (
    'submit','middle_return','supervisor_return','requester_return','supervisor_forward','middle_forward','assign_worker',
    'middle_approve','supervisor_approve','requester_confirm'
  ));

-- For in-progress legacy rounds, recover the active supervisor count from the original events.
create function app.visual_workflow_round_totals(p_request uuid,p_category text,p_totals jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  forwarded app.visual_workflow_entries;
begin
  if p_totals ? 'supervisorRoundId' then return p_totals; end if;

  select * into forwarded from app.visual_workflow_entries e
  where e.request_id=p_request and e.category_id=p_category and e.action='supervisor_forward'
  order by e.created_at desc,e.id desc limit 1;
  if not found then return p_totals || jsonb_build_object('supervisorRoundId',null); end if;

  return p_totals || jsonb_build_object('supervisorRoundId',forwarded.id,'supervisor',(
    select count(*) from app.visual_workflow_entries e
    where e.request_id=p_request and e.category_id=p_category and e.action='supervisor_return'
      and (e.created_at,e.id)>(forwarded.created_at,forwarded.id)
  ));
end $$;

revoke all on function app.visual_workflow_round_totals(uuid,text,jsonb) from public,anon,authenticated;


create or replace function app.visual_workflow_targets(r public.work_requests)
returns table(recipient_id uuid,category_id text,kind text,version bigint)
language sql stable set search_path='' as $$
  with flow as (
    select r.data->'visualCategoryWorkflow' as data, app.visual_workflow_active_supervisors(r.company_id) as supervisors
    where r.owner='design' and r.status not in ('draft','completed','cancelled','rejected')
      and r.data ? 'visualCategoryWorkflow' and coalesce(r.data->>'deleted','false')<>'true'
  ), lead as (
    select data,supervisors,app.visual_work_final_approver(data,supervisors) as id from flow
  ), categories as (
    select c.key as category,c.value as step,lead.data->>'receivedAt' as received_at,lead.id as supervisor,
      lead.supervisors,a.value->>'assigneeId' as middle
    from lead cross join lateral jsonb_each(lead.data->'categories') c
    left join lateral (select value from jsonb_array_elements(r.data->'categoryAssignments') where value->>'categoryId'=c.key) a on true
  ), targets as (
    select employee::text as employee,''::text as category,'receipt'::text as event,
      coalesce((data->>'receiptVersion')::bigint,r.revision) as event_version
    from lead cross join lateral unnest(case when lead.id is null then lead.supervisors else array[lead.id] end) employee
    where data->>'receivedAt' is null
    union all
    select case
        when step->>'state' in ('assignment','middle_review','middle_revision') then middle
        when step->>'state'='working' then step->>'workerId'
        when step->>'state'='requester_review' then r.requester_id::text
      end, category,
      case when received_at is null and step->>'state'='assignment' then 'registered'
           when step->>'state'='working' and step->>'roundId' is not null then 'rework'
           else step->>'state' end,
      (step->>'version')::bigint
    from categories
    union all
    select employee::text,category,step->>'state',(step->>'version')::bigint
    from categories cross join lateral unnest(case when supervisor is null then supervisors else array[supervisor] end) employee
    where step->>'state' in ('supervisor_review','supervisor_revision')
  )
  select p.id,t.category,t.event,t.event_version from targets t
  join public.profiles p on p.id::text=t.employee and p.company_id=r.company_id and p.status='active'
  where t.event='requester_review' or p.department_id=app.work_department('design')
$$;

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
  staged_result app.visual_work_category_comments;
  result_url text := nullif(btrim(coalesce(p_result_url,'')),'');
  note text := btrim(coalesce(p_note,''));
  next_status text;
  now_at timestamptz;
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and kind='request'
    and (data ? 'visualCategoryWorkflow' or p_action in ('receipt','assign_supervisor','assign_worker')) for update;
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

  now_at := clock_timestamp();
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
    if r.status in ('requested','reviewing') then next_status := 'inProgress'; end if;
  elsif p_action='assign_supervisor' then
    if p_person is null or not p_person=any(supervisors) or not app.work_manage_allowed('design') then
      raise exception '업무 관리 담당자가 재직 총괄 관리자를 지정해 주세요.' using errcode='42501';
    end if;
    flow := flow || jsonb_build_object('approverId',p_person,'receiptVersion',r.revision+1);
  else
    step := flow->'categories'->p_category;
    if step is null then
      raise exception '처리할 Visual 업무 분류를 확인해 주세요.' using errcode='42501';
    end if;
    state := step->>'state';
    worker := (step->>'workerId')::uuid;
    previous_worker := worker;
    result_id := (step->>'resultId')::uuid;
    round_id := (step->>'roundId')::uuid;
    select h.totals,h.assignments into counts,cycles from app.visual_workflow_feedback h
      where h.request_id=r.id and h.category_id=p_category;
    counts := app.visual_workflow_round_totals(r.id,p_category,coalesce(counts,'{}'::jsonb));
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
        select * into staged_result from app.visual_work_category_comments c where c.id=p_command for update;
        if found and (staged_result.audience<>'result' or staged_result.request_id<>r.id
          or staged_result.category_id<>p_category or staged_result.author_id<>actor
          or staged_result.published_at is not null) then
          raise exception '이 작업의 결과물 첨부를 확인해 주세요.' using errcode='42501';
        end if;
        if (note='' and result_url is null and staged_result.id is null) or length(note)>10000 or
          (result_url is not null and (length(result_url)>2048 or result_url !~ '^https?://[^[:space:]]+$')) then
          raise exception '결과 내용, http(s) 링크 또는 첨부파일을 확인해 주세요.' using errcode='22023';
        end if;
        if staged_result.id is not null then
          if exists (
            select from jsonb_array_elements(staged_result.files) f where not exists (
              select from storage.objects o where o.bucket_id='company-work-requests' and o.name=f->>'path'
                and o.metadata->>'size'=f->>'size'
            )
          ) then
            raise exception '업로드가 끝난 첨부파일을 확인해 주세요.' using errcode='22023';
          end if;
          update app.visual_work_category_comments set published_at=now_at where id=staged_result.id;
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
        flow := flow || jsonb_build_object('approverId',actor,'receivedAt',coalesce(flow->'receivedAt',to_jsonb(now_at)));
        if p_action='supervisor_approve' then
          update app.visual_workflow_entries set shared_at=now_at
            where id=result_id and request_id=r.id and category_id=p_category and action='submit';
          if not found then raise exception '공유할 결과물이 없습니다.' using errcode='40001'; end if;
          next_state := 'requester_review';
        else
          if p_action='supervisor_return' then
            counter := 'supervisor';
          else
            counts := counts || jsonb_build_object('supervisor',0,'supervisorRoundId',p_command);
          end if;
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
      counts := counts || jsonb_build_object('middle',0);
      cycle_id := p_command;
      cycles := cycles || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id',cycle_id,'workerId',worker,'assignedAt',now_at,'middle',0,
        'reason',case when p_action='middle_forward' then 'review' when previous_worker is not null then 'handoff' else 'initial' end,
        'previousWorkerId',case when previous_worker is distinct from worker then previous_worker end,
        'sourceResultId',result_id,'supervisorRoundId',counts->'supervisorRoundId',
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

    if counter is not null or p_action in ('submit','assign_worker','supervisor_forward','middle_forward',
      'middle_approve','supervisor_approve','requester_confirm') then
      insert into app.visual_workflow_entries(id,request_id,category_id,actor_id,action,round_id,note,result_url,created_at,assignment_id)
      values(p_command,r.id,p_category,actor,p_action,round_id,note,case when p_action='submit' then result_url end,now_at,cycle_id);
    end if;
    -- An independent reassignment starts a new assignment notification.
    if p_action='assign_worker' then
      step := step - 'roundId';
    end if;
    step := step || jsonb_strip_nulls(jsonb_build_object('state',next_state,'workerId',worker,'version',r.revision+1,
      'resultId',result_id,'roundId',case when p_action='assign_worker' then null else round_id end));
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

create or replace function app.visual_workflow_feedback_role(r public.work_requests,p_category text) returns text
language sql stable set search_path='' as $$
  select case
    when app.work_manage_allowed('design') or (me.department_id=app.work_department('design') and (
      (me.id=any(lead.supervisors) and (lead.approver is null or lead.approver=me.id))
      or exists(select from jsonb_array_elements(r.data->'categoryAssignments') a
        where a->>'categoryId'=p_category and a->>'assigneeId'=me.id::text)
    )) then 'manager'
    when r.requester_id=me.id then 'requester'
    when me.department_id=app.work_department('design')
      and r.data->'visualCategoryWorkflow'->'categories'->p_category->>'workerId'=me.id::text then 'worker'
  end
  from public.profiles me
  cross join lateral (select app.visual_workflow_active_supervisors(r.company_id) as supervisors) active
  cross join lateral (select active.supervisors,app.visual_work_final_approver(r.data->'visualCategoryWorkflow',active.supervisors) as approver) lead
  where me.id=auth.uid() and me.company_id=r.company_id and me.status='active'
$$;

create or replace function app.visual_work_category_discussion_allowed(p_request uuid, p_category text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.work_requests r
    join public.profiles me on me.id = auth.uid() and me.company_id = r.company_id and me.status = 'active'
    where r.id = p_request and r.owner = 'design' and r.status <> 'draft'
      and coalesce(r.data->>'deleted','false') <> 'true'
      and app.visual_work_category_exists(r.data,p_category)
      and case when (r.data->'visualCategoryWorkflow'->'categories') ? p_category
        then app.visual_workflow_feedback_role(r,p_category) is not null
        else r.requester_id = me.id or app.work_manage_allowed(r.owner)
          or jsonb_path_exists(r.data, '$.categoryAssignments[*] ? (@.categoryId == $category && @.assigneeId == $employee)',
            jsonb_build_object('category',p_category,'employee',me.id::text), true)
      end
  )
$$;

-- Result objects use the same private bucket and cleanup path as category attachments.
create function app.visual_work_category_content_visible(r public.work_requests,c app.visual_work_category_comments) returns boolean
language sql stable set search_path='' as $$
  select coalesce(case
    when r.status='draft' or r.data->>'deleted'='true' then false
    when c.audience='result' then case viewer.role
      when 'manager' then true
      when 'requester' then exists (
        select from app.visual_workflow_entries e where e.id=c.id and e.request_id=r.id and e.category_id=c.category_id
          and e.action='submit' and e.actor_id=c.author_id and e.shared_at is not null
      )
      when 'worker' then c.author_id=auth.uid() or exists (
        select from app.visual_workflow_feedback h where h.request_id=r.id and h.category_id=c.category_id
          and h.assignments->-1->>'sourceResultId'=c.id::text
      )
      else false
    end
    when (r.data->'visualCategoryWorkflow'->'categories') ? c.category_id
      then viewer.role='manager' or (c.audience='shared' and viewer.role in ('worker','requester'))
    else app.visual_work_category_discussion_allowed(r.id,c.category_id)
  end,false)
  from (select app.visual_workflow_feedback_role(r,c.category_id) as role) viewer
$$;

create or replace function app.list_visual_work_category_comments(p_request uuid, p_category text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.visual_work_category_discussion_allowed(p_request,p_category) then
    raise exception '이 분류의 댓글을 조회할 권한이 없습니다.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canWrite', (select r.status not in ('cancelled','rejected')
      and case when (r.data->'visualCategoryWorkflow'->'categories') ? p_category
        then app.visual_workflow_feedback_role(r,p_category) in ('manager','requester') else true end
      from public.work_requests r where r.id=p_request),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'authorId', c.author_id, 'authorName', c.author_name,
        'authorDepartment', c.author_department, 'replyTo', c.reply_to,
        'body', c.body, 'files', c.files, 'createdAt', c.published_at,
        'internal', c.audience='legacy' and coalesce((r.data->'visualCategoryWorkflow'->'categories') ? c.category_id,false)
      ) order by c.published_at, c.id)
      from app.visual_work_category_comments c
      join public.work_requests r on r.id=c.request_id
      where c.request_id=p_request and c.category_id=p_category and c.published_at is not null
        and c.audience<>'result' and app.visual_work_category_content_visible(r,c)
    ), '[]'::jsonb)
  );
end;
$$;

create function app.save_visual_work_category_content(
  p_request uuid, p_category text, p_id uuid, p_body text, p_reply_to uuid, p_files jsonb, p_publish boolean, p_result boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  request public.work_requests%rowtype;
  comment app.visual_work_category_comments%rowtype;
  manifest jsonb := '[]';
  item jsonb;
  file_index integer := 0;
  content text := btrim(coalesce(p_body,''));
  content_audience text;
  step jsonb;
begin
  select * into request from public.work_requests where id=p_request for share;
  if not found or not app.visual_work_category_discussion_allowed(p_request,p_category) then
    raise exception '이 분류에 자료를 등록할 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_result then
    step := request.data->'visualCategoryWorkflow'->'categories'->p_category;
    if not exists (select 1 from app.visual_work_category_comments c
      where c.id=p_id and c.request_id=p_request and c.category_id=p_category
        and c.author_id=auth.uid() and c.audience='result' and c.published_at is not null
    ) and (
      step->>'state' is distinct from 'working' or step->>'workerId' is distinct from auth.uid()::text
      or request.status in ('cancelled','rejected','completed')
    ) then
      raise exception '현재 작업자만 결과물 파일을 등록할 수 있습니다.' using errcode='42501';
    end if;
    content_audience := 'result';
  elsif (request.data->'visualCategoryWorkflow'->'categories') ? p_category then
    if app.visual_workflow_feedback_role(request,p_category) not in ('manager','requester') then
      raise exception '요청자와 이 분류의 관리자만 댓글을 등록할 수 있습니다.' using errcode='42501';
    end if;
    content_audience := 'shared';
  else
    content_audience := 'legacy';
  end if;

  if p_id is null or p_publish is null or jsonb_typeof(p_files) is distinct from 'array' or length(content)>10000 then
    raise exception '댓글 입력을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files)>5 or (content='' and jsonb_array_length(p_files)=0) then
    raise exception '내용 또는 첨부파일을 확인해 주세요.' using errcode = '22023';
  end if;
  if p_reply_to is not null then
    select parent.audience into content_audience from app.visual_work_category_comments parent
    where parent.request_id=p_request and parent.category_id=p_category and parent.id=p_reply_to
      and parent.reply_to is null and parent.published_at is not null and parent.audience<>'result'
      and app.visual_work_category_content_visible(request,parent);
    if not found then
      raise exception '열람할 수 있는 같은 분류의 댓글에만 답글을 쓸 수 있습니다.' using errcode = '22023';
    end if;
  end if;

  for item in select value from jsonb_array_elements(p_files)
  loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'name'),0) not between 1 and 255
      or item->>'name' ~ '[[:cntrl:]/\\]'
      or item->>'name' ~* '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$'
      or coalesce(item->>'type','') !~ '^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$'
      or length(item->>'type')>150
      or coalesce(item->>'size','') !~ '^[0-9]{1,8}$'
    then
      raise exception '첨부파일 형식을 확인해 주세요.' using errcode = '22023';
    end if;
    if (item->>'size')::integer not between 1 and 20971520 then
      raise exception '첨부파일은 한 개당 20MB까지 올릴 수 있습니다.' using errcode = '22023';
    end if;
    file_index := file_index + 1;
    manifest := manifest || jsonb_build_array(jsonb_build_object(
      'name',item->>'name', 'type',item->>'type', 'size',(item->>'size')::integer,
      'path','visual-comments/' || request.company_id || '/' || p_request || '/' || p_id || '/' || file_index
    ));
  end loop;

  if request.status in ('cancelled','rejected') and not exists (
    select 1 from app.visual_work_category_comments c
    where c.id=p_id and c.author_id=auth.uid() and c.request_id=p_request
      and c.category_id=p_category and c.published_at is not null
  ) then
    raise exception '종료된 업무에는 댓글을 쓸 수 없습니다.' using errcode = '42501';
  end if;

  insert into app.visual_work_category_comments(
    id, request_id, category_id, author_id, author_name, author_department, reply_to, body, files, audience
  )
  select p_id,p_request,p_category,me.id,coalesce(me.display_name,'직원'),coalesce(d.name,''),p_reply_to,content,manifest,content_audience
  from public.profiles me left join public.departments d on d.id=me.department_id and d.company_id=me.company_id
  where me.id=auth.uid()
  on conflict (id) do nothing;

  select * into comment from app.visual_work_category_comments where id=p_id for update;
  if not found or comment.author_id is distinct from auth.uid()
    or comment.request_id is distinct from p_request or comment.category_id is distinct from p_category
    or comment.reply_to is distinct from p_reply_to or comment.body is distinct from content or comment.files is distinct from manifest
    or (comment.audience='result') is distinct from p_result
  then
    raise exception '같은 전송 번호로 다른 댓글을 저장할 수 없습니다.' using errcode = '40001';
  end if;

  if not p_result and comment.published_at is null and (p_publish or file_index=0) then
    if exists (
      select 1 from jsonb_array_elements(manifest) f
      where not exists (
        select 1 from storage.objects o where o.bucket_id='company-work-requests' and o.name=f->>'path'
          and o.metadata->>'size'=f->>'size'
      )
    ) then
      raise exception '업로드가 끝난 첨부파일을 확인해 주세요.' using errcode = '22023';
    end if;
    update app.visual_work_category_comments set published_at=clock_timestamp()
    where id=p_id returning * into comment;
  end if;

  return jsonb_build_object('published',comment.published_at is not null,'files',coalesce((
    select jsonb_agg(f || jsonb_build_object('uploaded', exists (
      select 1 from storage.objects o where o.bucket_id='company-work-requests' and o.name=f->>'path'
        and o.metadata->>'size'=f->>'size'
    )) order by ord)
    from jsonb_array_elements(comment.files) with ordinality t(f,ord)
  ),'[]'::jsonb));
end;
$$;

create or replace function app.save_visual_work_category_comment(
  p_request uuid,p_category text,p_id uuid,p_body text,p_reply_to uuid,p_files jsonb,p_publish boolean
) returns jsonb language sql security definer set search_path='' as $$
  select app.save_visual_work_category_content(p_request,p_category,p_id,p_body,p_reply_to,p_files,p_publish,false)
$$;

create function app.reserve_visual_work_result_files(p_request uuid,p_category text,p_id uuid,p_files jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select app.save_visual_work_category_content(p_request,p_category,p_id,'',null,p_files,false,true)
$$;

create function public.reserve_visual_work_result_files(p_request uuid,p_category text,p_id uuid,p_files jsonb) returns jsonb
language sql set search_path='' as $$
  select app.reserve_visual_work_result_files(p_request,p_category,p_id,p_files)
$$;

create or replace function app.visual_work_comment_object_allowed(p_path text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.visual_work_category_comments c
    join public.work_requests r on r.id=c.request_id
    join public.profiles me on me.id=auth.uid() and me.company_id=r.company_id and me.status='active'
    where c.id=case when split_part(p_path,'/',4) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then split_part(p_path,'/',4)::uuid end
      and p_path like 'visual-comments/%'
      and c.files @> jsonb_build_array(jsonb_build_object('path',p_path))
      and case p_action
        when 'upload' then c.published_at is null and c.author_id=me.id and r.status not in ('cancelled','rejected')
          and app.visual_work_category_discussion_allowed(c.request_id,c.category_id)
          and (c.audience<>'result' or (
            r.data->'visualCategoryWorkflow'->'categories'->c.category_id->>'state'='working'
            and r.data->'visualCategoryWorkflow'->'categories'->c.category_id->>'workerId'=me.id::text
            and r.status<>'completed'
          ))
        when 'read' then
          (c.published_at is not null and app.visual_work_category_content_visible(r,c))
          or (c.published_at is null and c.author_id=me.id)
          or (r.requester_id=me.id and r.data->>'deleted'='true')
        when 'remove' then (c.published_at is null and c.author_id=me.id)
          or (r.requester_id=me.id and r.data->>'deleted'='true')
        else false
      end
  )
$$;

revoke all on function app.visual_work_category_content_visible(public.work_requests,app.visual_work_category_comments),
  app.save_visual_work_category_content(uuid,text,uuid,text,uuid,jsonb,boolean,boolean),
  app.reserve_visual_work_result_files(uuid,text,uuid,jsonb), public.reserve_visual_work_result_files(uuid,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function app.reserve_visual_work_result_files(uuid,text,uuid,jsonb),
  public.reserve_visual_work_result_files(uuid,text,uuid,jsonb) to authenticated;

create function app.visual_workflow_entry_payload(e app.visual_workflow_entries,p_actor_name text) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',e.id,'action',e.action,'note',e.note,'resultUrl',e.result_url,'roundId',e.round_id,
    'createdAt',e.created_at,'sharedAt',e.shared_at,'assignmentId',e.assignment_id,'actorName',p_actor_name,
    'files',case when e.action='submit' then coalesce((
      select c.files from app.visual_work_category_comments c
      where c.id=e.id and c.request_id=e.request_id and c.category_id=e.category_id
        and c.author_id=e.actor_id and c.audience='result' and c.published_at is not null
    ),'[]'::jsonb) else '[]'::jsonb end
  )
$$;

revoke all on function app.visual_workflow_entry_payload(app.visual_workflow_entries,text) from public,anon,authenticated;

create or replace function app.get_visual_workflow_review(p_request uuid,p_category text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  r public.work_requests;
  projected jsonb;
  view_role text;
  cycle jsonb;
  totals jsonb;
  current_counts jsonb;
  assignments jsonb;
  current_id uuid;
  result jsonb;
  handoff jsonb;
  entries jsonb;
  past_assignments jsonb;
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and status<>'draft' and coalesce(data->>'deleted','false')<>'true';
  if not found then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;
  if not (r.data ? 'visualCategoryWorkflow') and to_regprocedure('app.visual_workflow_for_request(public.work_requests)') is not null then
    projected := app.visual_workflow_for_request(r);
    if projected is not null then r.data := r.data||jsonb_build_object('visualCategoryWorkflow',projected); end if;
  end if;
  view_role := app.visual_workflow_feedback_role(r,p_category);
  if view_role is null or not coalesce((r.data->'visualCategoryWorkflow'->'categories') ? p_category,false) then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;

  if view_role='requester' then
    select app.visual_workflow_entry_payload(e,null)-array['roundId','assignmentId','actorName'] into result
    from app.visual_workflow_entries e where e.request_id=r.id and e.category_id=p_category
      and e.action='submit' and e.shared_at is not null order by e.shared_at desc,e.id desc limit 1;
    return jsonb_build_object('role',view_role,'result',result,'entries','[]'::jsonb,'assignments','[]'::jsonb,'reviewRounds',true);
  end if;

  select h.assignments,h.totals into assignments,totals from app.visual_workflow_feedback h
    where h.request_id=r.id and h.category_id=p_category;
  cycle := assignments->-1;
  current_id := (cycle->>'id')::uuid;

  select coalesce(jsonb_agg(app.visual_workflow_entry_payload(e,p.display_name)
    order by e.created_at desc,e.id desc),'[]'::jsonb) into entries
  from app.visual_workflow_entries e left join public.profiles p on p.id=e.actor_id and p.company_id=r.company_id
  where e.request_id=r.id and e.category_id=p_category and (
    view_role='manager' or (
      e.assignment_id is not distinct from current_id and (
        (e.action='submit' and e.actor_id=actor)
        or (current_id is not null and e.action in ('assign_worker','middle_return','middle_forward','middle_approve'))
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
    totals := app.visual_workflow_round_totals(r.id,p_category,coalesce(totals,'{}'::jsonb));
    current_counts := jsonb_strip_nulls(jsonb_build_object(
      'middle',cycle->'middle','supervisor',totals->'supervisor','requester',totals->'requester'));
    select coalesce(jsonb_agg(a.value||jsonb_build_object('workerName',p.display_name) order by a.ordinality),'[]'::jsonb)
    into assignments from jsonb_array_elements(coalesce(assignments,'[]'::jsonb)) with ordinality a(value,ordinality)
      left join public.profiles p on p.id::text=a.value->>'workerId' and p.company_id=r.company_id;
    return jsonb_build_object('role',view_role,'result',null,'handoff',null,'entries',entries,'assignments',assignments,
      'currentCounts',current_counts,'reviewRounds',true);
  end if;

  select app.visual_workflow_entry_payload(e,p.display_name)-array['roundId','assignmentId','sharedAt'] into handoff
  from app.visual_workflow_entries e left join public.profiles p on p.id=e.actor_id and p.company_id=r.company_id
  where e.request_id=r.id and e.category_id=p_category and e.action='submit' and e.id=(cycle->>'sourceResultId')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.value->>'id','middle',coalesce((a.value->>'middle')::int,0),
    'entries',coalesce((
      select jsonb_agg(app.visual_workflow_entry_payload(e,p.display_name) order by e.created_at desc,e.id desc)
      from app.visual_workflow_entries e left join public.profiles p on p.id=e.actor_id and p.company_id=r.company_id
      where e.request_id=r.id and e.category_id=p_category and e.assignment_id=(a.value->>'id')::uuid
        and (e.action in ('assign_worker','middle_return','middle_forward','middle_approve') or (e.action='submit' and e.actor_id=actor))
    ),'[]'::jsonb)
  ) order by a.ordinality),'[]'::jsonb) into past_assignments
  from jsonb_array_elements(coalesce(assignments,'[]'::jsonb)) with ordinality a(value,ordinality)
  where a.value->>'workerId'=actor::text and a.ordinality<jsonb_array_length(assignments);

  assignments := jsonb_build_array(jsonb_build_object('middle',(
    select count(*) from jsonb_array_elements(entries) item where item->>'action'='middle_return'
  )));
  return jsonb_build_object('role',view_role,'result',null,'handoff',handoff,'entries',entries,'assignments',assignments,
    'pastAssignments',past_assignments,'previousMiddleCounts',coalesce((
      select jsonb_agg(a.value->'middle' order by a.ordinality)
      from jsonb_array_elements(past_assignments) with ordinality a(value,ordinality)
    ),'[]'::jsonb),'reviewRounds',true);
end $$;

notify pgrst,'reload schema';
