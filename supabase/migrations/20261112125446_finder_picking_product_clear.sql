-- Extend the existing Finder product clear to registered picking slots.
do $migration$
declare
  definition text := replace(pg_get_functiondef('app.finder_warehouse_placement(uuid,text,jsonb)'::regprocedure), E'\r\n', E'\n');
  old_clear constant text := $old$if v_zone <> 'box_storage' or v_number = '' then raise exception '박스창고와 상품을 확인해주세요.'; end if;$old$;
  new_clear constant text := $new$if v_zone not in ('box_storage', 'picking') or v_number = '' then raise exception '창고 자리와 상품을 확인해주세요.'; end if;$new$;
  old_read constant text := $old$return jsonb_build_object('zone', v_zone, 'groups', v_groups, 'box',$old$;
  new_read constant text := $new$return jsonb_build_object('zone', v_zone, 'groups', v_groups,
      'canClear', v_zone in ('box_storage', 'picking'), 'box',$new$;
begin
  if strpos(definition, old_clear) = 0 or strpos(definition, old_read) = 0 then
    raise exception 'Finder 창고 저장 함수의 기존 조건을 확인해주세요.';
  end if;

  execute replace(replace(definition, old_clear, new_clear), old_read, new_read);
end;
$migration$;
