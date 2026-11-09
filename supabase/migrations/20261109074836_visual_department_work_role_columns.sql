-- Expose role-specific summaries through the existing department list and its access checks.
do $patch$
declare
  v_definition text := pg_get_functiondef('app.list_department_work(text)'::regprocedure);
  v_assignees constant text := '''assigneeNames'',people.names';
  v_approval constant text := '''requestedAt'',r.data->''visualFinalApproval''->''requestedAt''';
begin
  if strpos(v_definition, v_assignees) = 0 or strpos(v_definition, v_approval) = 0
    or strpos(v_definition, '''visualMiddleManagerIds''') > 0 then
    raise exception '부서 업무 목록의 역할 요약을 추가할 위치를 확인해 주세요.';
  end if;

  v_definition := replace(v_definition, v_assignees, v_assignees || $field$,
    'visualMiddleManagerIds', case when r.owner='design' then (
      select coalesce(jsonb_agg(manager.id order by manager.first_category), '[]'::jsonb)
      from (
        select assignment.value->>'assigneeId' as id, min(assignment.ordinality) as first_category
        from jsonb_array_elements(coalesce(r.data->'categoryAssignments','[]'::jsonb))
          with ordinality as assignment(value, ordinality)
        where people.ids ? (assignment.value->>'assigneeId')
        group by assignment.value->>'assigneeId'
      ) manager
    ) end$field$);

  execute replace(v_definition, v_approval, v_approval || $field$,
    'approvedBy',r.data->'visualFinalApproval'->'approvedBy'$field$);
end
$patch$;
