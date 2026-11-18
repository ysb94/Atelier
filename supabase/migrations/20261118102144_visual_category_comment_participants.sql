-- Keep the existing discussion, attachment, and result checks for each category.
do $patch$
declare
  discussion_def text := pg_get_functiondef('app.visual_work_category_discussion_allowed(uuid,text)'::regprocedure);
  list_def text := pg_get_functiondef('app.list_visual_work_category_comments(uuid,text)'::regprocedure);
  save_def text := pg_get_functiondef('app.save_visual_work_category_content(uuid,text,uuid,text,uuid,jsonb,boolean,boolean)'::regprocedure);
  legacy_members constant text := $match$else r.requester_id = me.id or app.work_manage_allowed(r.owner)$match$;
  write_gate constant text := $match$
      and case when (r.data->'visualCategoryWorkflow'->'categories') ? p_category
        then app.visual_workflow_feedback_role(r,p_category) in ('manager','requester') else true end$match$;
  save_gate constant text := $match$  elsif (request.data->'visualCategoryWorkflow'->'categories') ? p_category then
    if app.visual_workflow_feedback_role(request,p_category) not in ('manager','requester') then
      raise exception '요청자와 이 분류의 관리자만 댓글을 등록할 수 있습니다.' using errcode='42501';
    end if;
    content_audience := 'shared';
  else
    content_audience := 'legacy';$match$;
begin
  if strpos(discussion_def, legacy_members) = 0
    or strpos(list_def, write_gate) = 0
    or strpos(save_def, save_gate) = 0 then
    raise exception 'Visual 분류 댓글의 기존 권한 함수 정의를 확인해 주세요.';
  end if;

  execute replace(discussion_def, legacy_members, legacy_members || $addition$
          or exists (
            select 1
            from (select app.visual_workflow_active_supervisors(r.company_id) as ids) active
            where me.id = any(active.ids)
              and coalesce(app.visual_work_final_approver(r.data->'visualFinalApproval',active.ids),me.id) = me.id
          )$addition$);
  execute replace(list_def, write_gate, '');
  execute replace(save_def, save_gate, $replacement$  else
    -- New comments remain shared when an older request enters the category workflow.
    -- Replies inherit the visible parent comment's audience below.
    content_audience := 'shared';$replacement$);
end $patch$;
