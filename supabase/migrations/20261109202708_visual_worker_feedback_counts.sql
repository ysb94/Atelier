create or replace function app.get_visual_workflow_review(p_request uuid,p_category text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  r public.work_requests;
  view_role text;
  cycle jsonb;
  assignments jsonb;
  current_id uuid;
  previous_middle_counts jsonb;
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
    -- Keep the current assignment payload for older clients and expose only the worker's own earlier counts.
    select coalesce(jsonb_agg(coalesce((a.value->>'middle')::int,0) order by a.ordinality),'[]'::jsonb)
      into previous_middle_counts
    from jsonb_array_elements(coalesce(assignments,'[]'::jsonb)) with ordinality a(value,ordinality)
    where a.value->>'workerId'=actor::text and a.ordinality<jsonb_array_length(assignments);

    assignments := jsonb_build_array(jsonb_build_object('middle',(
      select count(*) from jsonb_array_elements(entries) item where item->>'action'='middle_return'
    )));
  end if;
  return jsonb_build_object('role',view_role,'result',null,'handoff',handoff,'entries',entries,'assignments',assignments)
    || case when view_role='worker' then jsonb_build_object('previousMiddleCounts',previous_middle_counts) else '{}'::jsonb end;
end $$;
