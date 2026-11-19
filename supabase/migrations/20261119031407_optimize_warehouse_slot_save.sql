-- Keep the existing slot save API and RLS. Avoid writing unchanged registrations
-- or locking and creating locations for stock that already has the right zone.
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
  v_source_ids uuid[];
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

  select coalesce(array_agg(code order by code), '{}'::text[]) into v_codes
  from (select distinct btrim(value) as code from unnest(p_codes) value
        where value is not null and btrim(value) <> '') cleaned;

  delete from public.warehouse_registered_slots
  where warehouse_id = p_warehouse_id and zone = p_zone and not (code = any(v_codes));

  with current_zone as materialized (
    select r.code from public.warehouse_registered_slots r
    where r.warehouse_id = p_warehouse_id and r.zone = p_zone
  )
  insert into public.warehouse_registered_slots (warehouse_id, code, zone)
  select p_warehouse_id, requested.code, p_zone
  from unnest(v_codes) requested(code)
  left join current_zone current on current.code = requested.code
  where current.code is null
  on conflict (warehouse_id, code) do update set zone = excluded.zone
    where warehouse_registered_slots.zone is distinct from excluded.zone;

  select coalesce(array_agg(code order by code), '{}'::text[]) into v_actual
  from public.warehouse_registered_slots where warehouse_id = p_warehouse_id and zone = p_zone;
  if v_actual is distinct from v_codes then raise exception '자리 저장 권한을 확인하세요. 변경을 취소했습니다.'; end if;

  with picking as materialized (
    select r.code from public.warehouse_registered_slots r
    where r.warehouse_id = p_warehouse_id and r.zone = 'picking'
  )
  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_source_ids
  from public.warehouse_locations l
  left join picking r on r.code = l.code
  where l.warehouse_id = p_warehouse_id and l.zone in ('picking','box_storage')
    and (l.zone = 'picking') is distinct from (r.code is not null);

  select count(*)::integer into v_expected
  from public.warehouse_stock_positions p
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
    and p.location_id = any(v_source_ids);
  if v_expected = 0 then
    return jsonb_build_object('registered_count', cardinality(v_codes), 'reclassified_count', 0);
  end if;

  perform p.id from public.warehouse_stock_positions p
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
    and p.location_id = any(v_source_ids)
  order by p.id for update;

  with needed as materialized (
    select distinct p.location_id
    from public.warehouse_stock_positions p
    where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
      and p.location_id = any(v_source_ids)
  ), destinations as (
    select l.code, case l.zone when 'picking' then 'box_storage' else 'picking' end as zone
    from needed n join public.warehouse_locations l on l.id = n.location_id
  )
  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  select v_company_id, p_warehouse_id, d.code, d.zone from destinations d
  where not exists (
    select 1 from public.warehouse_locations l
    where l.warehouse_id = p_warehouse_id and l.code = d.code and l.zone = d.zone
  )
  on conflict (warehouse_id, zone, code) do nothing;

  update public.warehouse_stock_positions p set location_id = target.id
  from public.warehouse_locations source
  join public.warehouse_locations target on target.warehouse_id = source.warehouse_id
    and target.code = source.code
    and target.zone = case source.zone when 'picking' then 'box_storage' else 'picking' end
  where p.brand_id = p_brand_id and p.set_id = v_set_id and p.warehouse_id = p_warehouse_id
    and p.location_id = any(v_source_ids) and source.id = p.location_id;
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected then raise exception '재고 분류 권한을 확인하세요. 자리 저장을 취소했습니다.'; end if;

  update public.warehouse_inventory_sets set updated_at = now() where id = v_set_id and brand_id = p_brand_id;
  return jsonb_build_object('registered_count', cardinality(v_codes), 'reclassified_count', v_changed);
end;
$function$;

revoke all on function public.save_warehouse_registered_slots(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.save_warehouse_registered_slots(uuid, uuid, text, text[]) to authenticated;
