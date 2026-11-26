-- Read-only summaries. Existing work, review, handover and notification records remain authoritative.
-- Private personal cards require the same explicit actor predicates as list_personal_work_cards.
create function app.list_my_home_related_work(
  p_view text, p_before_at timestamptz default null, p_before_key text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid := app.permission_company_id();
begin
  if actor is null or company is null then
    raise exception '본인 업무를 조회할 수 없습니다.' using errcode = '42501';
  end if;
  if p_view is null or p_view not in ('feedback', 'issued')
    or (p_before_at is null) <> (p_before_key is null) then
    raise exception '업무 조회 조건을 확인해 주세요.' using errcode = '22023';
  end if;

  return (
    with department as materialized (
      select r.* from public.work_requests r
      where r.company_id = company and r.owner in ('planning', 'design', 'md', 'logistics')
        and r.status <> 'draft' and coalesce(r.data->>'deleted', 'false') <> 'true'
        and (app.work_request_read(r.id) or app.department_work_read(r.id))
    ), personal as (
      select 'personal:' || c.id as key, c.updated_at as activity_at,
        jsonb_build_object(
          'source', 'personal', 'id', c.id, 'owner', null, 'title', c.title,
          'requesterName', owner.display_name, 'assigneeNames', jsonb_build_array(worker.display_name),
          'status', c.status, 'round', c.round, 'noticeId', notice.id, 'targets', '[]'::jsonb
        ) as summary
      from app.personal_work_cards c
      join public.profiles owner on owner.id = coalesce(c.handover_owner_id, c.created_by)
      join public.profiles worker on worker.id = c.assignee_id
      left join public.personal_work_feedback_notices notice on notice.card_id = c.id
        and notice.recipient_id = actor and notice.card_revision = c.revision and notice.resolved_at is null
      where c.company_id = company and c.deleted_at is null and (
        (p_view = 'feedback' and c.status = 'feedback' and c.reviewer_id = actor)
        or (p_view = 'issued' and coalesce(c.handover_owner_id, c.created_by) = actor and c.assignee_id <> actor)
      )
    ), work as (
      select 'department:' || r.id as key, r.updated_at as activity_at,
        jsonb_build_object(
          'source', 'department', 'id', r.id, 'owner', r.owner, 'title', r.data->'values'->>'title',
          'isRequester', r.requester_id = actor, 'internal', r.kind = 'internal',
          'requesterName', requester.display_name, 'assigneeNames', people.names,
          'status', r.status, 'round', null, 'noticeId', null, 'targets', reviews.targets,
          'finalApprovalPending', r.owner = 'design' and r.status = 'completionConfirm'
            and nullif(r.data->'visualFinalApproval'->>'requestedAt', '') is not null
        ) as summary
      from department r join public.profiles requester on requester.id = r.requester_id
      cross join lateral (
        select coalesce(jsonb_agg(p.display_name order by p.display_name, p.id), '[]') as names,
          coalesce(bool_or(p.id <> actor), false) as has_other
        from public.profiles p where p.company_id = company and p.id::text in (
          select r.data->>'assignee'
          union select jsonb_array_elements_text(coalesce(r.data->'collaborators', '[]'))
          union select a->>'assigneeId' from jsonb_array_elements(coalesce(r.data->'categoryAssignments', '[]')) a
          union select step->>'workerId' from jsonb_each(coalesce(r.data->'visualCategoryWorkflow'->'categories', '{}')) c(category, step)
        )
      ) people
      cross join lateral (
        select coalesce(jsonb_agg(target order by target->>'categoryId', target->>'kind'), '[]') as targets
        from (
          select jsonb_build_object('categoryId', t.category_id, 'kind', t.kind, 'version', t.version,
            'label', coalesce((select a->>'label' from jsonb_array_elements(coalesce(r.data->'categoryAssignments', '[]')) a
              where a->>'categoryId' = t.category_id limit 1), t.category_id)) as target
          from app.visual_workflow_targets(r) t
          where t.recipient_id = actor and t.kind in
            ('middle_review', 'supervisor_review', 'requester_review', 'supervisor_revision', 'middle_revision')
          union all
          select jsonb_build_object('categoryId', '', 'kind',
            case when r.owner = 'design' and r.status = 'completionConfirm'
              and nullif(r.data->'visualFinalApproval'->>'requestedAt', '') is not null
              then 'final_approval' else r.status end, 'version', r.revision, 'label', '')
          where not (r.data ? 'visualCategoryWorkflow') and (
            (r.status = 'completionReview' and app.work_manage_allowed(r.owner))
            or (r.status = 'completionConfirm' and case
              when r.owner = 'design' and nullif(r.data->'visualFinalApproval'->>'requestedAt', '') is not null
              then actor = app.visual_work_final_approver(r.data->'visualFinalApproval', app.visual_workflow_active_supervisors(company))
              else r.requester_id = actor end)
          )
        ) targets
      ) reviews
      where (p_view = 'feedback' and r.status not in ('completed', 'cancelled', 'rejected') and reviews.targets <> '[]'::jsonb)
        or (p_view = 'issued' and (
          (r.requester_id = actor and (r.kind = 'request' or people.has_other))
          or (r.data->>'assignedBy' = actor::text and people.has_other)
          or exists(select from jsonb_array_elements(coalesce(r.data->'categoryAssignments', '[]')) a
            where a->>'assignedBy' = actor::text and nullif(a->>'assigneeId', '') is not null and a->>'assigneeId' <> actor::text)
          or exists(select from app.visual_workflow_entries e
            where e.request_id = r.id and e.actor_id = actor and e.action = 'assign_worker'
              and nullif(r.data->'visualCategoryWorkflow'->'categories'->e.category_id->>'workerId', '') is not null
              and r.data->'visualCategoryWorkflow'->'categories'->e.category_id->>'workerId' <> actor::text)
        ))
    ), all_work as materialized (
      select * from personal union all select * from work
    ), page as materialized (
      select * from all_work where p_before_at is null or (activity_at, key) < (p_before_at, p_before_key)
      order by activity_at desc, key desc limit 21
    ), visible as materialized (
      select * from page order by activity_at desc, key desc limit 20
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(summary || jsonb_build_object('key', key, 'activityAt', activity_at)
        order by activity_at desc, key desc) from visible), '[]'),
      'total', (select count(*) from all_work),
      'nextCursor', case when (select count(*) from page) > 20 then
        (select jsonb_build_object('at', activity_at, 'key', key) from visible order by activity_at, key limit 1)
        else null end
    )
  );
end $$;

create function public.list_my_home_related_work(
  p_view text, p_before_at timestamptz default null, p_before_key text default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.list_my_home_related_work(p_view, p_before_at, p_before_key)
$$;

revoke all on function app.list_my_home_related_work(text,timestamptz,text),
  public.list_my_home_related_work(text,timestamptz,text) from public, anon, authenticated;
grant execute on function app.list_my_home_related_work(text,timestamptz,text),
  public.list_my_home_related_work(text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
