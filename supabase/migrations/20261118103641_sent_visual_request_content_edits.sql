-- Keep the existing request lock, revision check, command ledger and file validation.
do $migration$
declare
  definition text;
  boundary text;
begin
  definition := pg_get_functiondef('app.save_work_request(uuid,bigint,jsonb,uuid)'::regprocedure);
  boundary := $old$not (own and r.status in ('draft','requested')) then raise exception '접수 전 본인 요청만 수정할 수 있습니다.'$old$;
  if strpos(definition, boundary)=0 then raise exception '작업 요청 저장 함수 정의가 변경되었습니다.'; end if;
  execute replace(definition, boundary, $new$not (own and (
    r.status in ('draft','requested') or (r.kind='request' and r.owner='design'
      and r.status in ('reviewing','accepted','inProgress','waiting','completionReview','completionConfirm')
      and p_patch-'values'='{}'::jsonb))) then raise exception '진행 중인 본인 요청의 내용만 수정할 수 있습니다.'$new$);

  definition := pg_get_functiondef('app.begin_work_request_file(uuid,text,text,bigint)'::regprocedure);
  boundary := $old$(requester_id=auth.uid() and status in ('draft','requested'))$old$;
  if strpos(definition, boundary)=0 then raise exception '작업 요청 첨부 함수 정의가 변경되었습니다.'; end if;
  execute replace(definition, boundary, $new$(requester_id=auth.uid() and (status in ('draft','requested') or
    (kind='request' and owner='design' and status in ('reviewing','accepted','inProgress','waiting','completionReview','completionConfirm'))))$new$);

  definition := pg_get_functiondef('app.apply_work_request_categories()'::regprocedure);
  boundary := $old$new.status='requested' and (old.status='draft' or new.data->'values' is distinct from old.data->'values')$old$;
  if strpos(definition, boundary)=0 then raise exception '작업 분류 검증 함수 정의가 변경되었습니다.'; end if;
  definition := replace(definition, boundary, $new$(new.status='requested' and (old.status='draft' or new.data->'values' is distinct from old.data->'values'))
    or (new.kind='request' and new.status in ('reviewing','accepted','inProgress','waiting','completionReview','completionConfirm')
      and new.data->'values' is distinct from old.data->'values'
      and new.data->'values'->'visualRequest' ? 'categories')$new$);
  boundary := $old$new.data:=jsonb_set(new.data,'{categoryAssignments}',assignments);$old$;
  if strpos(definition, boundary)=0 then raise exception '작업 분류 저장 함수 정의가 변경되었습니다.'; end if;
  execute replace(definition, boundary, $new$if new.status='requested' then
    new.data:=jsonb_set(new.data,'{categoryAssignments}',assignments);
  else
    assignments:=previous;
  end if;$new$);

  definition := pg_get_functiondef('app.sync_visual_workflow_notices()'::regprocedure);
  boundary := $old$n.request_id=new.id and n.resolved_at is null and not exists ($old$;
  if strpos(definition, boundary)=0 then raise exception 'Visual 알림 동기화 함수 정의가 변경되었습니다.'; end if;
  execute replace(definition, boundary, $new$n.request_id=new.id and n.resolved_at is null and n.kind<>'content_updated' and not exists ($new$);
end $migration$;

-- The empty section key represents the shared main content.
create function app.visual_request_content_sections(p_values jsonb) returns jsonb
language sql immutable set search_path='' as $$
  with blocks as (
    select b.*, case when value->>'type'='text' and value->>'id' ~ '^visual-request-section:[a-zA-Z0-9_-]{1,64}$'
      and value->>'id'<>'visual-request-section:main' then substring(value->>'id' from 24) end as marker
    from jsonb_array_elements(coalesce(p_values->'blocks','[]')) with ordinality b(value,ord)
  ), located as (
    select *, max(ord) filter(where marker is not null) over(order by ord) as marker_ord from blocks
  ), grouped as (
    select coalesce(m.marker,'') as section, coalesce(jsonb_agg(l.value-'id' order by l.ord) filter (
      where l.marker is null and (l.value->>'type'<>'text' or btrim(coalesce(l.value->>'text',''))<>'' or l.value ? 'visualAnswer')
    ),'[]') as body
    from located l left join blocks m on m.ord=l.marker_ord group by 1
  ), fields as (
    select value->>'id' as section, coalesce(value->'fields','{}') as answers
    from jsonb_array_elements(case when jsonb_typeof(p_values->'visualRequest'->'categories')='array'
      then p_values->'visualRequest'->'categories' else '[]' end)
    where value->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$' and value->>'id'<>'main'
  ), sections as (
    select '' as section union select section from grouped union select section from fields
  )
  select jsonb_object_agg(s.section, jsonb_build_object('body',coalesce(g.body,'[]'))
    || case when s.section='' then jsonb_build_object('title',p_values->'title','dueDate',p_values->'dueDate',
          'referenceFiles',coalesce((select jsonb_agg(value-'id' order by ord)
            from jsonb_array_elements(coalesce(p_values->'referenceFiles','[]')) with ordinality f(value,ord)),'[]'))
        else jsonb_build_object('answers',coalesce(f.answers,'{}')) end)
  from sections s left join grouped g using(section) left join fields f using(section)
$$;

create function app.guard_sent_visual_request_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'requested' and (
    (select array_agg(key order by key) from jsonb_object_keys(app.visual_request_content_sections(old.data->'values')) key)
    is distinct from
    (select array_agg(key order by key) from jsonb_object_keys(app.visual_request_content_sections(new.data->'values')) key)
  ) then
    raise exception '접수된 요청의 작업 분류는 변경할 수 없습니다.' using errcode='22023';
  end if;
  return new;
end $$;

create trigger guard_sent_visual_request_content before update of data on public.work_requests
for each row when (old.owner='design' and old.kind='request' and old.status<>'draft'
  and old.status=new.status and old.data->'values' is distinct from new.data->'values')
execute function app.guard_sent_visual_request_content();

create function app.visual_request_edit_recipients(r public.work_requests,p_category text) returns setof uuid
language sql stable set search_path='' as $$
  with supervisors as (
    select app.visual_workflow_active_supervisors(r.company_id) as active_ids
  ), lead as (
    select active_ids,app.visual_work_final_approver(coalesce(r.data->'visualCategoryWorkflow',r.data->'visualFinalApproval'),active_ids) as id
    from supervisors
  ), candidates as (
    select person.id::text from lead cross join lateral unnest(case when lead.id is null then active_ids else array[lead.id] end) person(id)
    union all
    select a->>'assigneeId' from jsonb_array_elements(coalesce(r.data->'categoryAssignments','[]')) a
    where p_category='' or a->>'categoryId'=p_category
    union all
    select step->>'workerId' from jsonb_each(coalesce(r.data->'visualCategoryWorkflow'->'categories','{}')) c(id,step)
    where p_category='' or c.id=p_category
    union all
    select r.data->>'assignee' where not (r.data ? 'visualCategoryWorkflow')
    union all
    select r.data->>'assignedBy' where not (r.data ? 'visualCategoryWorkflow')
  )
  select distinct p.id from candidates c(id) join public.profiles p on p.id::text=c.id
  where p.id<>r.requester_id and p.company_id=r.company_id and p.status='active'
    and p.department_id=app.work_department('design')
$$;

create function app.notify_sent_visual_request_edit() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous_sections jsonb := app.visual_request_content_sections(old.data->'values');
begin
  insert into public.visual_workflow_notices(request_id,company_id,recipient_id,category_id,kind,version)
  select new.id,new.company_id,people.id,changed.key,'content_updated',new.revision
  from jsonb_each(app.visual_request_content_sections(new.data->'values')) changed
  cross join lateral app.visual_request_edit_recipients(new,changed.key) people(id)
  where changed.value is distinct from previous_sections->changed.key
  on conflict (request_id,recipient_id,category_id,kind,version) where resolved_at is null do nothing;
  return new;
end $$;

create trigger notify_sent_visual_request_edit after update of data on public.work_requests
for each row when (old.owner='design' and old.kind='request' and old.status=new.status
  and old.status not in ('draft','completed','rejected','cancelled')
  and old.data->'values' is distinct from new.data->'values')
execute function app.notify_sent_visual_request_edit();

do $migration$
declare definition text; boundary text;
begin
  definition := pg_get_functiondef('app.list_my_visual_workflow_notices()'::regprocedure);
  boundary := 'and (w.requester_id=auth.uid() or app.department_work_read(w.id))';
  if strpos(definition, boundary)=0 then raise exception 'Visual 알림 조회 권한 정의가 변경되었습니다.'; end if;
  execute replace(definition, boundary, boundary||$legacy$ and n.kind<>'content_updated'$legacy$);
  definition := replace(definition, 'app.list_my_visual_workflow_notices()', 'app.list_my_visual_workflow_notices_with_content()');
  boundary := 'n.resolved_at is null and exists (';
  if strpos(definition, boundary)=0 then raise exception 'Visual 알림 조회 함수 정의가 변경되었습니다.'; end if;
  definition := replace(definition, boundary, $new$n.resolved_at is null and case when n.kind='content_updated' then
      w.status not in ('draft','completed','rejected','cancelled') and coalesce(w.data->>'deleted','false')<>'true'
    else exists ($new$);
  boundary := ') as current';
  if strpos(definition, boundary)=0 then raise exception 'Visual 알림 상태 조회 함수 정의가 변경되었습니다.'; end if;
  execute replace(definition,boundary,') end as current');
end $migration$;

create function public.list_my_visual_workflow_notices_with_content() returns jsonb
language sql stable security invoker set search_path='' as $$
  select app.list_my_visual_workflow_notices_with_content()
$$;

revoke all on function app.list_my_visual_workflow_notices_with_content(),
  public.list_my_visual_workflow_notices_with_content() from public,anon;
grant execute on function app.list_my_visual_workflow_notices_with_content(),
  public.list_my_visual_workflow_notices_with_content() to authenticated;

revoke all on function app.visual_request_content_sections(jsonb),app.guard_sent_visual_request_content(),
  app.visual_request_edit_recipients(public.work_requests,text),app.notify_sent_visual_request_edit()
  from public,anon,authenticated;

notify pgrst,'reload schema';
