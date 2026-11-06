-- A finished round can still be marked received by the assigned employee. Shipping stays limited to open rounds.
do $migration$
declare body text;
  old_guard text := 'and r.item->>''id''=p_order and not r.closed)';
  new_guard text := 'and r.item->>''id''=p_order and (p_action=''check'' or not r.closed))';
begin
 select pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure) into body;
 if strpos(body, old_guard)=0 then
  raise exception 'China work order receipt guard changed; review before applying';
 end if;
 execute replace(body, old_guard, new_guard);
end $migration$;
