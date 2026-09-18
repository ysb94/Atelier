-- 개별 박스는 박스창고에서 밀봉 상태만 허용한다.
-- 개봉·소진은 택배 포장 또는 대량 출고를 하는 출고창고로 이동한 뒤 처리한다.

do $$
begin
  if exists (
    select 1
    from public.warehouse_boxes as box
    join public.warehouse_locations as location
      on location.id = box.location_id
    where location.zone = 'box_storage'
      and box.current_qty <> box.initial_qty
  ) then
    raise exception '박스창고에 개봉되었거나 소진된 개별 박스가 있어 규칙을 적용할 수 없습니다.';
  end if;
end;
$$;

create or replace function public.enforce_warehouse_box_boundaries()
returns trigger
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_brand_company uuid;
  v_location_company uuid;
  v_location_warehouse uuid;
  v_location_zone text;
  v_expected_warehouse uuid;
begin
  new.display_code := upper(btrim(new.display_code));
  new.note := coalesce(new.note, '');
  new.usage_priority := coalesce(new.usage_priority, 'fifo');

  if tg_op = 'UPDATE' and old.archived_at is not null then
    if new.archived_at is distinct from old.archived_at
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '보관된 박스는 수정할 수 없습니다.';
    end if;
  end if;

  if new.current_qty > new.initial_qty then
    raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
  end if;

  select loc.company_id, loc.warehouse_id, loc.zone
    into v_location_company, v_location_warehouse, v_location_zone
  from public.warehouse_locations as loc
  where loc.id = new.location_id;

  if v_location_zone = 'box_storage'
    and new.current_qty <> new.initial_qty then
    raise exception '박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.';
  end if;

  new.status := app.warehouse_box_status(new.initial_qty, new.current_qty);

  select brand.company_id
    into v_brand_company
  from public.brands as brand
  where brand.id = new.brand_id;

  select resolved.warehouse_id
    into v_expected_warehouse
  from app.resolve_brand_warehouse(new.brand_id) as resolved;

  if v_brand_company is null
    or v_location_company is distinct from v_brand_company then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;
  if v_expected_warehouse is not null
    and v_location_warehouse is distinct from v_expected_warehouse then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_warehouse_box_boundaries() is
  '개별 박스의 브랜드·상품·자리·수량 경계와 박스창고 밀봉 전용 규칙을 강제한다.';
