-- Expose pending legacy requests through the existing detail and list access checks.
-- Persist the category workflow only when an authorized supervisor action succeeds.
create function app.visual_workflow_for_request(p_work public.work_requests) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  categories jsonb;
begin
  if p_work.data ? 'visualCategoryWorkflow' then
    return p_work.data->'visualCategoryWorkflow';
  end if;
  if p_work.owner <> 'design' or p_work.kind <> 'request' or p_work.status not in ('requested', 'reviewing')
    or coalesce(p_work.data->>'deleted', 'false') = 'true' or coalesce(p_work.data->>'assignee', '') <> ''
    or jsonb_typeof(p_work.data->'categoryAssignments') is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(p_work.data->'categoryAssignments') = 0
    or cardinality(app.visual_workflow_active_supervisors(p_work.company_id)) = 0 then
    return null;
  end if;

  select jsonb_object_agg(a->>'categoryId', jsonb_build_object('state', 'assignment', 'version', p_work.revision))
    into categories
    from jsonb_array_elements(p_work.data->'categoryAssignments') a
    where nullif(a->>'categoryId', '') is not null;
  if categories is null then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'categories', categories,
    'receiptVersion', p_work.revision,
    'approverId', p_work.data->'visualFinalApproval'->>'approverId'
  ));
end $$;

revoke all on function app.visual_workflow_for_request(public.work_requests) from public, anon, authenticated;

-- Keep the existing RPC signatures, owners, grants and read/write predicates.
do $patch$
declare
  list_def text := pg_get_functiondef('app.list_department_work(text)'::regprocedure);
  detail_def text := pg_get_functiondef('app.get_department_work(uuid)'::regprocedure);
  change_def text := pg_get_functiondef('app.change_visual_category_work(uuid,text,bigint,text,uuid,text,text,uuid)'::regprocedure);
  list_anchor constant text := $match$'status',r.status$match$;
  detail_anchor constant text := $match$jsonb_build_array(r.data||jsonb_build_object($match$;
  change_row constant text := $match$and owner='design' and kind='request' and data ? 'visualCategoryWorkflow' for update;$match$;
  change_flow constant text := $match$flow := r.data->'visualCategoryWorkflow';$match$;
  change_supervisors constant text := $match$supervisors := app.visual_workflow_active_supervisors(r.company_id);$match$;
begin
  if strpos(list_def, list_anchor) = 0 or strpos(detail_def, detail_anchor) = 0
    or strpos(change_def, change_row) = 0 or strpos(change_def, change_flow) = 0
    or strpos(change_def, change_supervisors) = 0 then
    raise exception 'Visual 총괄 접수에 필요한 기존 조회·처리 함수 정의를 확인해 주세요.';
  end if;

  execute replace(list_def, list_anchor, list_anchor || $field$,
    'visualReceiptPending', case when r.owner='design' and r.status in ('requested', 'reviewing') then (
      select workflow.data is not null and workflow.data->>'receivedAt' is null
      from app.visual_workflow_for_request(r) as workflow(data)
    ) end$field$);

  execute replace(detail_def, detail_anchor, $field$jsonb_build_array(r.data || coalesce((
    select jsonb_build_object('visualCategoryWorkflow', case when r.data ? 'visualCategoryWorkflow' then workflow.data
      else workflow.data || '{"legacyReceiptPending":true}'::jsonb end)
    from app.visual_workflow_for_request(r) as workflow(data)
    where workflow.data is not null
  ), '{}'::jsonb) || jsonb_build_object($field$);

  change_def := replace(change_def, change_row, $field$and owner='design' and kind='request'
    and (data ? 'visualCategoryWorkflow' or p_action in ('receipt', 'assign_supervisor')) for update;$field$);
  change_def := replace(change_def, change_flow, '');
  execute replace(change_def, change_supervisors, $field$flow := app.visual_workflow_for_request(r);
  if flow is null then
    raise exception '총괄 접수가 가능한 Visual 요청을 확인해 주세요.' using errcode='42501';
  end if;
  $field$ || change_supervisors);
end $patch$;
