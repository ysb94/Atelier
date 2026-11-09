-- Keep the original detail and attachment access; only omit completed requests from the worker queue.
do $migration$
declare
  body text := pg_get_functiondef('app.read_material_requests(text,uuid,integer)'::regprocedure);
  anchor text := 'where q.company_id=v_company and q.deleted_at is null and (p_id is null or q.id=p_id)';
  guard text := 'and (v_role<>''worker'' or p_id is not null or q.status<>''completed'')';
begin
  if strpos(body,anchor)=0 or strpos(body,guard)>0
    or strpos(body,'(v_role<>''worker'' or r.assignee_id=v_uid)')=0 then
    raise exception 'Material request list definition changed; review before applying';
  end if;
  execute replace(body,anchor,anchor||chr(10)||'      '||guard);
end $migration$;
