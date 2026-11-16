-- Allow known sheet storage locations without weakening registered picking rules.
-- Patch only destination resolution; retain the deployed ACL, locks and writeback hooks.
do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb)'::regprocedure
  );
  v_before text := $old$    select * into v_dest from public.warehouse_registered_slots
    where warehouse_id = v_old.warehouse_id and upper(code) = upper(btrim(p_payload->>'to_location_code'));
    if not found or v_dest.zone not in ('box_storage','picking') then
      raise exception '등록된 도착 자리번호를 입력하세요.' using errcode = '22023';
    end if;$old$;
  v_after text := $new$    select * into v_dest from public.warehouse_registered_slots
    where warehouse_id = v_old.warehouse_id and upper(code) = upper(btrim(p_payload->>'to_location_code'));
    if not found then
      -- Sheet imports retain locations even when all their stock has moved away.
      -- Only a unique storage location in this warehouse may be reused.
      -- A registered slot always wins, including its picking classification.
      select l.code, l.zone into v_dest.code, v_dest.zone
      from public.warehouse_locations l
      where l.warehouse_id = v_old.warehouse_id and l.zone = 'box_storage'
        and upper(l.code) = upper(btrim(p_payload->>'to_location_code'))
        and not exists (
          select 1 from public.warehouse_locations other
          where other.warehouse_id = l.warehouse_id
            and upper(other.code) = upper(l.code) and other.id <> l.id
        );
    end if;
    if v_dest.code is null or v_dest.zone is null or v_dest.zone not in ('box_storage','picking') then
      raise exception '등록된 자리 또는 기존 시트에서 사용한 보관 자리번호를 입력하세요.' using errcode = '22023';
    end if;$new$;
begin
  if strpos(v_definition, v_after) > 0 then return; end if;
  if (length(v_definition) - length(replace(v_definition, v_before, ''))) <> length(v_before) then
    raise exception 'save_warehouse_stock_work destination block changed; review before applying';
  end if;
  execute replace(v_definition, v_before, v_after);
end;
$migration$;
