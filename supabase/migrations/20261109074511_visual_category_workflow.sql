-- Opt in at publication so installed older clients and already-open work keep their original flow.
create table app.visual_workflow_entries (
  id uuid primary key,
  request_id uuid not null references public.work_requests(id) on delete cascade,
  category_id text not null,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('submit','middle_return','supervisor_return','requester_return','supervisor_forward','middle_forward')),
  round_id uuid,
  note text not null,
  result_url text,
  created_at timestamptz not null,
  shared_at timestamptz
);
create index visual_workflow_entries_category on app.visual_workflow_entries(request_id,category_id,created_at);
alter table app.visual_workflow_entries enable row level security;
revoke all on app.visual_workflow_entries from public, anon, authenticated;

create table public.visual_workflow_notices (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.work_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  recipient_id uuid not null references public.profiles(id),
  category_id text not null,
  kind text not null,
  version bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  resolved_at timestamptz
);
create unique index visual_workflow_notice_current on public.visual_workflow_notices
  (request_id,recipient_id,category_id,kind,version) where resolved_at is null;
create index visual_workflow_notice_recipient on public.visual_workflow_notices(recipient_id,created_at desc);
create index visual_workflow_notice_request on public.visual_workflow_notices(request_id);
alter table public.visual_workflow_notices enable row level security;
revoke all on public.visual_workflow_notices from public, anon, authenticated;
grant select on public.visual_workflow_notices to authenticated;
create policy visual_workflow_notice_recipient on public.visual_workflow_notices for select to authenticated
  using (recipient_id=(select auth.uid()) and company_id=(select app.permission_company_id()));

create function app.visual_workflow_active_supervisors(p_company uuid) returns uuid[]
language sql stable set search_path='' as $$
  select app.active_visual_work_supervisors(p_company, coalesce((
    select s.supervisor_ids from public.work_request_settings s where s.company_id=p_company and s.owner='design'
  ), '{}'::uuid[]))
$$;

create function app.visual_workflow_targets(r public.work_requests)
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
        when received_at is null or step->>'state' in ('assignment','middle_review','middle_revision') then middle
        when step->>'state'='working' then step->>'workerId'
        when step->>'state'='requester_review' then r.requester_id::text
      end, category,
      case when received_at is null then 'registered'
           when step->>'state'='working' and step->>'roundId' is not null then 'rework'
           else step->>'state' end,
      (step->>'version')::bigint
    from categories
    union all
    select employee::text,category,step->>'state',(step->>'version')::bigint
    from categories cross join lateral unnest(case when supervisor is null then supervisors else array[supervisor] end) employee
    where received_at is not null and step->>'state' in ('supervisor_review','supervisor_revision')
  )
  select p.id,t.category,t.event,t.event_version from targets t
  join public.profiles p on p.id::text=t.employee and p.company_id=r.company_id and p.status='active'
  where t.event='requester_review' or p.department_id=app.work_department('design')
$$;

create function app.sync_visual_workflow_notices() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not (new.data ? 'visualCategoryWorkflow') or
    (new.data->'visualCategoryWorkflow' is not distinct from old.data->'visualCategoryWorkflow'
     and new.data->'categoryAssignments' is not distinct from old.data->'categoryAssignments'
     and new.status=old.status and new.data->'deleted' is not distinct from old.data->'deleted') then
    return new;
  end if;
  with wanted as materialized (select * from app.visual_workflow_targets(new)),
  retire as (
    update public.visual_workflow_notices n set resolved_at=clock_timestamp()
    where n.request_id=new.id and n.resolved_at is null and not exists (
      select from wanted w where (w.recipient_id,w.category_id,w.kind,w.version)=(n.recipient_id,n.category_id,n.kind,n.version)
    )
  )
  insert into public.visual_workflow_notices(request_id,company_id,recipient_id,category_id,kind,version)
  select new.id,new.company_id,w.recipient_id,w.category_id,w.kind,w.version from wanted w
  on conflict (request_id,recipient_id,category_id,kind,version) where resolved_at is null do nothing;
  return new;
end $$;

create trigger sync_visual_workflow_notices after update on public.work_requests
  for each row when (new.owner='design' and new.data ? 'visualCategoryWorkflow')
  execute function app.sync_visual_workflow_notices();

-- Requested work is editable until receipt. Keep matching categories and retire removed-category notices.
create function app.refresh_visual_workflow_categories() returns trigger
language plpgsql set search_path='' as $$
declare
  flow jsonb := old.data->'visualCategoryWorkflow';
  categories jsonb;
begin
  select jsonb_object_agg(a->>'categoryId',coalesce(flow->'categories'->(a->>'categoryId'),
    jsonb_build_object('state','assignment','version',new.revision)))
  into categories from jsonb_array_elements(new.data->'categoryAssignments') a;
  if categories is null then
    raise exception '접수 전 요청에도 작업 분류를 한 개 이상 남겨 주세요.' using errcode='22023';
  end if;
  new.data := jsonb_set(new.data,'{visualCategoryWorkflow,categories}',categories);
  return new;
end $$;
create trigger refresh_visual_workflow_categories before update of data on public.work_requests
  for each row when (old.data ? 'visualCategoryWorkflow' and old.status='requested' and new.status='requested'
    and old.data->'categoryAssignments' is distinct from new.data->'categoryAssignments')
  execute function app.refresh_visual_workflow_categories();

-- Reuse the existing completion guard while preserving the legacy approval order for older work.
do $migration$
declare
  definition text := pg_get_functiondef('app.guard_visual_work_final_approval()'::regprocedure);
  boundary constant text := 'if old.owner <> ''design'' or old.status = new.status or old.status = ''completed'' then return new; end if;';
begin
  if strpos(definition,boundary)=0 then raise exception '기존 Visual 승인 검사 정의가 변경되었습니다.'; end if;
  execute replace(definition,boundary,$guard$
  if old.data ? 'visualCategoryWorkflow' then
    if not (new.data ? 'visualCategoryWorkflow')
      or (old.status is distinct from new.status and new.status not in ('cancelled','rejected')
        and old.data->'visualCategoryWorkflow' is not distinct from new.data->'visualCategoryWorkflow')
      or (new.status='completed' and (
        new.data->'visualCategoryWorkflow'->'categories'='{}'::jsonb
        or exists (select from jsonb_each(new.data->'visualCategoryWorkflow'->'categories') step
          where step.value->>'state' is distinct from 'confirmed')
      )) then
      raise exception '분류별 작업 단계에서 처리해 주세요.' using errcode='42501';
    end if;
    return new;
  end if;
  $guard$ || boundary);
end $migration$;

create function app.publish_visual_category_work(p_id uuid,p_revision bigint,p_patch jsonb,p_command uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare
  r public.work_requests;
  categories jsonb;
begin
  select * into r from public.work_requests where id=p_id and company_id=app.permission_company_id()
    and requester_id=auth.uid() and owner='design' and kind='request' for update;
  if not found then raise exception '본인이 작성한 Visual 요청만 등록할 수 있습니다.' using errcode='42501'; end if;
  if exists(select from public.work_request_commands where actor_id=auth.uid() and command_id=p_command and request_id=p_id) then
    return r.revision;
  end if;
  if r.status<>'draft' or p_patch->>'status' is distinct from 'requested' then
    raise exception '등록할 요청 상태를 다시 확인해 주세요.' using errcode='40001';
  end if;
  perform app.save_work_request(p_id,p_revision,p_patch,p_command);
  select * into r from public.work_requests where id=p_id;
  select jsonb_object_agg(a->>'categoryId',jsonb_build_object('state','assignment','version',r.revision+1))
    into categories from jsonb_array_elements(coalesce(r.data->'categoryAssignments','[]')) a;
  if categories is null then return r.revision; end if;
  perform 1 from public.work_request_settings s where s.company_id=r.company_id and s.owner='design' for share;
  if cardinality(app.visual_workflow_active_supervisors(r.company_id))=0 then
    raise exception 'Visual 총괄 관리자를 지정한 뒤 요청을 등록해 주세요.' using errcode='22023';
  end if;
  update public.work_requests set data=jsonb_set(data,'{visualCategoryWorkflow}',
    jsonb_build_object('categories',categories,'receiptVersion',r.revision+1)),revision=revision+1
    where id=r.id returning revision into r.revision;
  return r.revision;
end $$;

create function app.change_visual_category_work(p_request uuid,p_category text,p_revision bigint,p_action text,
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
      round_id := p_command;
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
      'resultId',result_id,'roundId',round_id,'feedback',counts));
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

create function app.list_visual_workflow_entries(p_request uuid,p_category text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  r public.work_requests;
  flow jsonb;
  member boolean;
  manages boolean;
  worker boolean;
  supervisors uuid[];
  supervisor uuid;
begin
  select * into r from public.work_requests where id=p_request and company_id=app.permission_company_id()
    and owner='design' and data ? 'visualCategoryWorkflow' and coalesce(data->>'deleted','false')<>'true';
  flow := r.data->'visualCategoryWorkflow';
  if not found or actor is null or not coalesce((flow->'categories') ? p_category,false) then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;
  member := exists(select from public.profiles p where p.id=actor and p.company_id=r.company_id
    and p.status='active' and p.department_id=app.work_department('design'));
  supervisors := app.visual_workflow_active_supervisors(r.company_id);
  supervisor := app.visual_work_final_approver(flow,supervisors);
  manages := app.work_manage_allowed('design') or (member and (
    (actor=any(supervisors) and (supervisor is null or actor=supervisor))
    or exists(select from jsonb_array_elements(r.data->'categoryAssignments') a
      where a->>'categoryId'=p_category and a->>'assigneeId'=actor::text)));
  worker := member and flow->'categories'->p_category->>'workerId'=actor::text;
  if r.requester_id<>actor and not coalesce(manages,false) and not coalesce(worker,false) then
    raise exception '이 분류의 기록을 조회할 권한이 없습니다.' using errcode='42501';
  end if;

  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,
    'resultUrl',e.result_url,'roundId',e.round_id,'createdAt',e.created_at,'sharedAt',e.shared_at) order by e.created_at desc,e.id)
    from app.visual_workflow_entries e where e.request_id=r.id and e.category_id=p_category and (
      manages
      or (worker and (e.action in ('middle_return','middle_forward') or (e.action='submit' and e.actor_id=actor)))
      or (r.requester_id=actor and ((e.action='submit' and e.shared_at is not null) or e.action='requester_return'))
    )), '[]'::jsonb);
end $$;

create function app.list_my_visual_workflow_notices() returns jsonb
language sql stable security definer set search_path='' as $$
  with mine as materialized (
    select n.*,w.data->'values'->>'title' as work_title,w.requester_id=auth.uid() and n.kind='requester_review' as personal,
      coalesce((select a->>'label' from jsonb_array_elements(w.data->'categoryAssignments') a
        where a->>'categoryId'=n.category_id),'') as category_label,
      n.resolved_at is null and exists (
        select from app.visual_workflow_targets(w) target
        where (target.recipient_id,target.category_id,target.kind,target.version)=(n.recipient_id,n.category_id,n.kind,n.version)
      ) as current
    from public.visual_workflow_notices n join public.work_requests w on w.id=n.request_id
    where n.recipient_id=auth.uid() and n.company_id=app.permission_company_id()
      and (w.requester_id=auth.uid() or app.department_work_read(w.id))
      and (n.resolved_at is null or n.created_at >= statement_timestamp()-interval '90 days')
  ), recent as (
    select * from mine order by current desc,created_at desc,id limit 150
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'requestId',request_id,'categoryId',category_id,
    'categoryLabel',category_label,'title',work_title,'kind',kind,'personal',personal,
    'version',version,'createdAt',created_at,'readAt',read_at,'current',current)
    order by created_at desc,id),'[]'::jsonb) from recent
$$;

create function app.read_my_visual_workflow_notices(p_request uuid,p_category text,p_revision bigint,p_ids uuid[]) returns void
language sql security definer set search_path='' as $$
  update public.visual_workflow_notices n set read_at=clock_timestamp()
  where n.recipient_id=auth.uid() and n.company_id=app.permission_company_id() and n.read_at is null
    and n.request_id=p_request and n.category_id in ('',p_category) and n.version<=p_revision
    and cardinality(p_ids) between 1 and 40 and n.id=any(p_ids)
    and exists(select from public.work_requests r where r.id=n.request_id
      and (r.requester_id=auth.uid() or app.department_work_read(r.id))
      and r.status<>'draft' and coalesce(r.data->>'deleted','false')<>'true')
$$;

-- A new worker participates in only the assigned category's conversation.
do $migration$
declare
  definition text := pg_get_functiondef('app.visual_work_category_discussion_allowed(uuid,text)'::regprocedure);
  boundary constant text := 'and (r.requester_id = me.id or app.work_manage_allowed(r.owner)';
begin
  if strpos(definition,boundary)=0 then raise exception '기존 Visual 대화 권한 정의가 변경되었습니다.'; end if;
  execute replace(definition,boundary,boundary || $policy$
        or (me.department_id=app.work_department('design') and (r.data->'visualCategoryWorkflow'->'categories') ? p_category
          and (r.data->'visualCategoryWorkflow'->'categories'->p_category->>'workerId'=me.id::text
            or me.id=app.visual_work_final_approver(r.data->'visualCategoryWorkflow',app.visual_workflow_active_supervisors(r.company_id))))
  $policy$);
end $migration$;

-- Add workers and the supervisor queue to the existing lightweight department board query.
do $migration$
declare
  definition text := pg_get_functiondef('app.list_department_work(text)'::regprocedure);
  category_source constant text := $part$select c->>'assigneeId' from jsonb_array_elements(coalesce(r.data->'categoryAssignments','[]')) c$part$;
  status_field constant text := $part$'status',r.status$part$;
begin
  if strpos(definition,category_source)=0 or strpos(definition,status_field)=0 then
    raise exception '기존 부서 업무 목록 정의가 변경되었습니다.';
  end if;
  execute replace(replace(definition,category_source,category_source || $part$
    union select c.value->>'workerId' from jsonb_each(coalesce(r.data->'visualCategoryWorkflow'->'categories','{}')) c$part$),
    status_field,status_field || $part$,'visualCategoryReview',case when r.data ? 'visualCategoryWorkflow' then
      jsonb_build_object('approverId',r.data->'visualCategoryWorkflow'->'approverId',
        'pending',r.status not in ('completed','cancelled','rejected') and exists(
          select from jsonb_each(r.data->'visualCategoryWorkflow'->'categories') c
          where c.value->>'state' in ('supervisor_review','supervisor_revision'))) end$part$);
end $migration$;

create or replace function public.get_work_request_settings(p_owner text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app.get_work_request_settings(p_owner) || jsonb_build_object('categoryWorkflowAvailable',true)
$$;

create function public.publish_visual_category_work(p_id uuid,p_revision bigint,p_patch jsonb,p_command uuid) returns bigint
language sql security invoker set search_path='' as $$
  select app.publish_visual_category_work(p_id,p_revision,p_patch,p_command)
$$;
create function public.change_visual_category_work(p_request uuid,p_category text,p_revision bigint,p_action text,
  p_person uuid,p_note text,p_result_url text,p_command uuid) returns bigint
language sql security invoker set search_path='' as $$
  select app.change_visual_category_work(p_request,p_category,p_revision,p_action,p_person,p_note,p_result_url,p_command)
$$;
create function public.list_visual_workflow_entries(p_request uuid,p_category text) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.list_visual_workflow_entries(p_request,p_category) $$;
create function public.list_my_visual_workflow_notices() returns jsonb
language sql stable security invoker set search_path='' as $$ select app.list_my_visual_workflow_notices() $$;
create function public.read_my_visual_workflow_notices(p_request uuid,p_category text,p_revision bigint,p_ids uuid[]) returns void
language sql security invoker set search_path='' as $$ select app.read_my_visual_workflow_notices(p_request,p_category,p_revision,p_ids) $$;

revoke all on function app.visual_workflow_active_supervisors(uuid),app.visual_workflow_targets(public.work_requests),
  app.sync_visual_workflow_notices(),app.refresh_visual_workflow_categories()
  from public,anon,authenticated;
do $grants$
declare f record;
begin
  for f in select p.oid,p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app','public') and p.proname in ('publish_visual_category_work','change_visual_category_work',
      'list_visual_workflow_entries','list_my_visual_workflow_notices','read_my_visual_workflow_notices')
  loop
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.nspname,f.proname,f.args);
    execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args);
  end loop;
  if exists(select from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.visual_workflow_notices;
  end if;
end $grants$;
notify pgrst,'reload schema';
