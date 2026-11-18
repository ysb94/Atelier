-- Route a middle manager's own submission through the existing supervisor review queue.
do $patch$
declare
  definition text := pg_get_functiondef('app.change_visual_category_work(uuid,text,bigint,text,uuid,text,text,uuid)'::regprocedure);
  before_submit constant text := $match$        result_id := p_command;
        next_state := 'middle_review';$match$;
  after_submit constant text := $replacement$        result_id := p_command;
        next_state := case when actor = middle then 'supervisor_review' else 'middle_review' end;$replacement$;
begin
  if strpos(definition, before_submit) = 0 then
    raise exception 'Visual 결과물 제출 함수의 기존 정의를 확인해 주세요.';
  end if;
  execute replace(definition, before_submit, after_submit);
end $patch$;
