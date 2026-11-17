-- Clearing an audited row must detach its box pointer before the composite
-- ON DELETE SET NULL foreign key can null both source_position_id and brand_id.
do $migration$
declare v_def text; v_old text := '  -- source_row_number is a display sort key for app-created stock until import.';
begin
  v_def := pg_get_functiondef('app.finish_finder_stock_db(uuid,uuid)'::regprocedure);
  if strpos(v_def,v_old)=0 then raise exception 'Unexpected Finder finish definition'; end if;
  execute replace(v_def,v_old,$replacement$
  update public.warehouse_boxes b set source_position_id=null
  where b.brand_id=p_brand_id and b.source_position_id in (
    select p.id from public.warehouse_stock_positions p
    join jsonb_array_elements(coalesce(v_op.plan->'clear','[]'::jsonb)) item
      on item->'row'->>'external_row_id'=p.external_row_id
    where p.set_id=v_set.id
  );

  -- source_row_number is a display sort key for app-created stock until import.$replacement$);
end;
$migration$;
