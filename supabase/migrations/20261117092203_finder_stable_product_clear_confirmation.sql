-- Keep "없음" confirmations tied to the actual product rows, not sheet import
-- bookkeeping. Still accept the original token while older clients are open.
do $migration$
declare
  v_def text := pg_get_functiondef('app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb)'::regprocedure);
  v_group constant text := $old$md5(jsonb_agg(item order by ord)::text) as token$old$;
  v_check constant text := $old$if md5(v_clear::text) is distinct from p_request->>'token' then$old$;
begin
  if strpos(v_def, v_group) = 0 or strpos(v_def, v_check) = 0 then
    raise exception 'Unexpected Finder product confirmation definition';
  end if;
  v_def := replace(v_def, v_group, 'app.finder_picking_slot_token(jsonb_agg(item order by ord)) as token');
  v_def := replace(v_def, v_check, $new$if md5(v_clear::text) is distinct from p_request->>'token'
      and app.finder_picking_slot_token(v_clear) is distinct from p_request->>'token' then$new$);
  execute v_def;
end;
$migration$;
