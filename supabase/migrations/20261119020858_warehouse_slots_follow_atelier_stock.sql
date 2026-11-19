-- Atelier's current stock determines occupied slots. Keep the existing shared
-- slot table as the catalog for both apps, including slots that are now empty.
set local lock_timeout = '3s';
set local statement_timeout = '25s';

create function app.reconcile_warehouse_stock_slots(p_warehouse_id uuid, p_codes text[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_slot record;
  v_changed integer := 0;
  v_count integer;
begin
  for v_slot in
    select btrim(l.code) as code, min(l.zone) as zone, count(distinct l.zone) as zones
    from public.warehouse_stock_positions p
    join public.warehouse_inventory_sets s on s.id=p.set_id and s.brand_id=p.brand_id
      and s.warehouse_id=p.warehouse_id and s.kind='sandbox' and s.status='active'
    join public.warehouse_locations l on l.id=p.location_id and l.warehouse_id=p.warehouse_id
    where p.warehouse_id=p_warehouse_id
      and (p.quantity_status='unknown' or coalesce(p.remaining_boxes,0)>0 or p.opened_units>0)
      and btrim(l.code) not in ('','0-0-0','(빈 자리)')
      and (p_codes is null or l.code=any(p_codes))
    group by btrim(l.code) order by btrim(l.code)
  loop
    if v_slot.zones<>1 then
      raise exception '같은 자리에 서로 다른 창고 구역의 재고가 있습니다. Atelier에서 구역을 확인해주세요. (%)',
        v_slot.code using errcode='23514';
    end if;
    insert into public.warehouse_registered_slots(warehouse_id,code,zone)
    values(p_warehouse_id,v_slot.code,v_slot.zone)
    on conflict(warehouse_id,code) do update set zone=excluded.zone
      where warehouse_registered_slots.zone is distinct from excluded.zone;
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;
  end loop;
  return v_changed;
end;
$$;
revoke all on function app.reconcile_warehouse_stock_slots(uuid,text[]) from public,anon,authenticated,service_role;

-- The old function silently skipped box storage, leaving new and edited
-- Atelier locations out of Finder's catalog.
create or replace function public.touch_warehouse_registered_slot(p_warehouse_id uuid,p_code text,p_zone text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_warehouse_id is null or btrim(coalesce(p_code,'')) in ('','0-0-0','(빈 자리)') then return; end if;
  if p_zone not in ('box_storage','picking') or p_zone is null then
    raise exception '창고 구역을 확인해주세요.' using errcode='22023';
  end if;
  insert into public.warehouse_registered_slots(warehouse_id,code,zone)
  values(p_warehouse_id,btrim(p_code),p_zone)
  on conflict(warehouse_id,code) do update set zone=excluded.zone
    where warehouse_registered_slots.zone is distinct from excluded.zone;
end;
$$;

-- One reconciliation per affected warehouse/statement also covers sheet
-- snapshots and manual imports, which do not call the ordinary intake helper.
create function app.sync_warehouse_slots_after_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_warehouse record;
begin
  for v_warehouse in
    select p.warehouse_id, array_agg(distinct l.code) as codes
    from new_stock_slot_rows p
    join public.warehouse_inventory_sets s on s.id=p.set_id and s.kind='sandbox' and s.status='active'
    join public.warehouse_locations l on l.id=p.location_id
    group by p.warehouse_id
  loop
    perform app.reconcile_warehouse_stock_slots(v_warehouse.warehouse_id,v_warehouse.codes);
  end loop;
  return null;
end;
$$;
revoke all on function app.sync_warehouse_slots_after_stock() from public,anon,authenticated,service_role;
create trigger warehouse_slots_after_stock_insert
after insert on public.warehouse_stock_positions
referencing new table as new_stock_slot_rows for each statement
execute function app.sync_warehouse_slots_after_stock();
create trigger warehouse_slots_after_stock_update
after update on public.warehouse_stock_positions
referencing new table as new_stock_slot_rows for each statement
execute function app.sync_warehouse_slots_after_stock();

create function app.sync_warehouse_slots_after_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind='sandbox' and new.status='active' then
    perform app.reconcile_warehouse_stock_slots(new.warehouse_id);
  end if;
  return null;
end;
$$;
revoke all on function app.sync_warehouse_slots_after_activation() from public,anon,authenticated,service_role;
create trigger warehouse_slots_after_set_activation
after update of status on public.warehouse_inventory_sets
for each row when (old.status is distinct from new.status)
execute function app.sync_warehouse_slots_after_activation();

-- An explicit Atelier slot reclassification may change catalog and stock in
-- one transaction. Check the final state so a Finder-only zone edit cannot
-- override the zone of occupied Atelier stock.
create function app.assert_warehouse_slot_matches_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_warehouse uuid;
  v_code text;
  v_registered text;
  v_zone text;
  v_zones integer;
begin
  if tg_op='DELETE' then v_warehouse:=old.warehouse_id; v_code:=old.code;
  else v_warehouse:=new.warehouse_id; v_code:=new.code; end if;
  select min(l.zone),count(distinct l.zone) into v_zone,v_zones
  from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id=p.set_id and s.kind='sandbox' and s.status='active'
  join public.warehouse_locations l on l.id=p.location_id
  where p.warehouse_id=v_warehouse and l.code=v_code
    and (p.quantity_status='unknown' or coalesce(p.remaining_boxes,0)>0 or p.opened_units>0);
  if v_zones=0 then return null; end if;
  select zone into v_registered from public.warehouse_registered_slots
  where warehouse_id=v_warehouse and code=v_code;
  if v_zones<>1 or v_registered is distinct from v_zone then
    raise exception 'Atelier에 재고가 있는 자리입니다. 현재 구역을 다시 조회해주세요. (%)',v_code using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function app.assert_warehouse_slot_matches_stock() from public,anon,authenticated,service_role;
create constraint trigger warehouse_slot_matches_stock
after insert or update or delete on public.warehouse_registered_slots
deferrable initially deferred for each row
execute function app.assert_warehouse_slot_matches_stock();

-- Repair the existing Masmarulez catalog without moving stock or rewriting
-- archived locations. Future writes use the triggers above.
do $backfill$
declare v_warehouse uuid;
begin
  for v_warehouse in
    select distinct s.warehouse_id from public.warehouse_inventory_sets s
    join public.brands b on b.id=s.brand_id and b.slug='masmarulez'
    where s.kind='sandbox' and s.status='active'
  loop
    perform app.reconcile_warehouse_stock_slots(v_warehouse);
  end loop;
end;
$backfill$;
