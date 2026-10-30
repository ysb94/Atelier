-- Additive RPC: no existing data changes until an authorized user saves slots.
-- Reclassify the selected brand's current sandbox snapshot; keep archived sets,
-- original location rows, quantities, row IDs and individual-box records intact.
create or replace function public.save_warehouse_registered_slots(
  p_brand_id uuid,
  p_warehouse_id uuid,
  p_zone text,
  p_codes text[]
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_company_id uuid;
  v_set_id uuid;
  v_codes text[];
  v_actual text[];
  v_expected integer;
  v_changed integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not coalesce(app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics', p_brand_id), false) then
    raise exception '창고 자리를 저장할 권한이 없습니다.';
  end if;
  if p_zone is null or p_zone not in ('picking', 'box_storage') then raise exception '창고 구역을 확인하세요.'; end if;
  if p_codes is null then raise exception '자리 목록을 확인하세요.'; end if;

  select w.company_id into v_company_id
  from public.warehouses w join public.brands b on b.company_id = w.company_id
  where w.id = p_warehouse_id and b.id = p_brand_id;
  if v_company_id is null then raise exception '브랜드와 창고를 확인하세요.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('warehouse-slots:' || p_warehouse_id::text, 0));
  select s.id into v_set_id from public.warehouse_inventory_sets s
  where s.brand_id = p_brand_id and s.warehouse_id = p_warehouse_id
    and s.kind = 'sandbox' and s.status = 'active'
  for update;
  if v_set_id is null then raise exception '현재 창고 재고 세트를 확인하세요.'; end if;
  perform p.id from public.warehouse_stock_positions p
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
  order by p.id for update;

  select coalesce(array_agg(code order by code), '{}'::text[]) into v_codes
  from (select distinct btrim(value) as code from unnest(p_codes) value
        where value is not null and btrim(value) <> '') cleaned;
  delete from public.warehouse_registered_slots
  where warehouse_id = p_warehouse_id and zone = p_zone and not (code = any(v_codes));
  insert into public.warehouse_registered_slots (warehouse_id, code, zone)
  select p_warehouse_id, code, p_zone from unnest(v_codes) code
  on conflict (warehouse_id, code) do update set zone = excluded.zone
    where warehouse_registered_slots.zone is distinct from excluded.zone;

  select coalesce(array_agg(code order by code), '{}'::text[]) into v_actual
  from public.warehouse_registered_slots where warehouse_id = p_warehouse_id and zone = p_zone;
  if v_actual is distinct from v_codes then raise exception '자리 저장 권한을 확인하세요. 변경을 취소했습니다.'; end if;

  select count(*)::integer into v_expected
  from public.warehouse_stock_positions p join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
    and l.zone is distinct from case when exists (
      select 1 from public.warehouse_registered_slots r
      where r.warehouse_id = p_warehouse_id and r.zone = 'picking' and r.code = l.code
    ) then 'picking' else 'box_storage' end;

  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  select distinct v_company_id, p_warehouse_id, l.code,
    case when exists (
      select 1 from public.warehouse_registered_slots r
      where r.warehouse_id = p_warehouse_id and r.zone = 'picking' and r.code = l.code
    ) then 'picking' else 'box_storage' end
  from public.warehouse_stock_positions p join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
  on conflict (warehouse_id, zone, code) do nothing;

  with plan as (
    select p.id, l.code, case when exists (
      select 1 from public.warehouse_registered_slots r
      where r.warehouse_id = p_warehouse_id and r.zone = 'picking' and r.code = l.code
    ) then 'picking' else 'box_storage' end as target_zone
    from public.warehouse_stock_positions p join public.warehouse_locations l on l.id = p.location_id
    where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
  )
  update public.warehouse_stock_positions p set location_id = target.id
  from plan join public.warehouse_locations target
    on target.warehouse_id = p_warehouse_id and target.code = plan.code and target.zone = plan.target_zone
  where p.id = plan.id and p.brand_id = p_brand_id and p.set_id = v_set_id
    and p.location_id is distinct from target.id;
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected then raise exception '재고 분류 권한을 확인하세요. 자리 저장을 취소했습니다.'; end if;

  if v_changed > 0 then
    update public.warehouse_inventory_sets set updated_at = now() where id = v_set_id and brand_id = p_brand_id;
  end if;
  return jsonb_build_object('registered_count', cardinality(v_codes), 'reclassified_count', v_changed);
end;
$function$;

revoke all on function public.save_warehouse_registered_slots(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.save_warehouse_registered_slots(uuid, uuid, text, text[]) to authenticated;
comment on function public.save_warehouse_registered_slots(uuid, uuid, text, text[]) is
  'Save exact registered slot codes and atomically reclassify current stock locations. Quantities and archived snapshots are preserved.';
