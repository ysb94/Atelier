-- 개별 박스 원장. 비어 있는 warehouse_boxes를 스냅샷과 독립적으로 쓰고
-- 등록·수정·이동·보관은 RPC 한 트랜잭션에서 이력까지 남긴다.
-- 1차 범위에서는 warehouse_stock_positions를 읽거나 바꾸지 않는다.

alter table public.warehouse_boxes
  alter column set_id drop not null;

alter table public.warehouse_boxes
  add column if not exists usage_priority text not null default 'fifo',
  add column if not exists note text not null default '',
  add column if not exists source_position_id uuid,
  add column if not exists created_by uuid,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

alter table public.warehouse_boxes
  drop constraint if exists warehouse_boxes_usage_priority_check;
alter table public.warehouse_boxes
  add constraint warehouse_boxes_usage_priority_check
  check (usage_priority in ('first', 'second', 'fifo', 'last'));

alter table public.warehouse_boxes
  drop constraint if exists warehouse_boxes_current_qty_check;
alter table public.warehouse_boxes
  add constraint warehouse_boxes_current_qty_check
  check (current_qty >= 0 and current_qty <= initial_qty);

alter table public.warehouse_boxes
  drop constraint if exists warehouse_boxes_set_code_key;
drop index if exists public.warehouse_boxes_brand_display_code_key;
create unique index warehouse_boxes_brand_display_code_key
  on public.warehouse_boxes (brand_id, display_code);

alter table public.warehouse_boxes
  drop constraint if exists warehouse_boxes_source_position_fkey;
alter table public.warehouse_boxes
  add constraint warehouse_boxes_source_position_fkey
  foreign key (brand_id, source_position_id)
  references public.warehouse_stock_positions (brand_id, id)
  on delete set null;

comment on table public.warehouse_boxes is
  '개별 박스 ID. 한 박스는 M번호 1종과 입고일 1개만 가진다. set_id가 없으면 연습 스냅샷과 독립이다.';
comment on column public.warehouse_boxes.set_id is
  '연습 스냅샷에 묶인 경우에만 채운다. 임시 창고관리 테스트 박스는 null이다.';
comment on column public.warehouse_boxes.usage_priority is
  '사용 순서. first/second/fifo/last.';
comment on column public.warehouse_boxes.source_position_id is
  '라벨 전환 시 원본 묶음 재고. 1차 테스트에서는 쓰지 않는다.';
comment on column public.warehouse_boxes.archived_at is
  '보관 시각. hard delete 대신 이 값으로 목록에서 뺀다.';

create index if not exists warehouse_boxes_brand_active_idx
  on public.warehouse_boxes (brand_id, created_at desc)
  where archived_at is null;

create index if not exists warehouse_boxes_location_idx
  on public.warehouse_boxes (location_id);

create table if not exists public.warehouse_box_movements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  box_id uuid not null,
  action text not null
    check (action in ('create', 'update', 'move', 'open', 'deplete', 'archive')),
  from_location_id uuid,
  from_location_code text,
  from_zone text,
  to_location_id uuid,
  to_location_code text,
  to_zone text,
  from_qty integer,
  to_qty integer,
  reason text not null default '',
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint warehouse_box_movements_brand_id_id_key unique (brand_id, id),
  constraint warehouse_box_movements_box_fkey
    foreign key (brand_id, box_id)
    references public.warehouse_boxes (brand_id, id)
    on delete cascade,
  constraint warehouse_box_movements_from_location_fkey
    foreign key (from_location_id)
    references public.warehouse_locations (id)
    on delete set null,
  constraint warehouse_box_movements_to_location_fkey
    foreign key (to_location_id)
    references public.warehouse_locations (id)
    on delete set null
);

comment on table public.warehouse_box_movements is
  '개별 박스 등록·수정·이동·개봉·소진·보관 이력. 묶음 재고 이력과 섞지 않는다.';

create index if not exists warehouse_box_movements_box_idx
  on public.warehouse_box_movements (brand_id, box_id, created_at desc);

alter table public.warehouse_box_movements enable row level security;

drop policy if exists warehouse_box_movements_select_member
  on public.warehouse_box_movements;
create policy warehouse_box_movements_select_member
on public.warehouse_box_movements
for select to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists warehouse_box_movements_write_editor
  on public.warehouse_box_movements;
create policy warehouse_box_movements_write_editor
on public.warehouse_box_movements
for all to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete on table public.warehouse_box_movements
  to authenticated;

create or replace function app.warehouse_box_status(
  p_initial_qty integer,
  p_current_qty integer
)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_current_qty <= 0 then 'depleted'
    when p_current_qty < p_initial_qty then 'opened'
    else 'sealed'
  end;
$$;

create or replace function app.resolve_brand_warehouse(target_brand_id uuid)
returns table (warehouse_id uuid, company_id uuid)
language sql
stable
security invoker
set search_path to ''
as $$
  select
    coalesce(
      (
        select inventory_set.warehouse_id
        from public.warehouse_inventory_sets as inventory_set
        where inventory_set.brand_id = target_brand_id
          and inventory_set.kind = 'sandbox'
          and inventory_set.status = 'active'
        limit 1
      ),
      (
        select warehouse.id
        from public.warehouses as warehouse
        join public.brands as brand
          on brand.company_id = warehouse.company_id
        where brand.id = target_brand_id
        order by warehouse.created_at
        limit 1
      )
    ) as warehouse_id,
    brand.company_id
  from public.brands as brand
  where brand.id = target_brand_id;
$$;

create or replace function app.ensure_warehouse_box_location(
  p_brand_id uuid,
  p_code text,
  p_zone text
)
returns uuid
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_warehouse_id uuid;
  v_company_id uuid;
  v_location_id uuid;
  v_code text;
  v_zone text;
begin
  v_code := btrim(coalesce(p_code, ''));
  v_zone := coalesce(nullif(btrim(p_zone), ''), 'box_storage');
  if v_code = '' then
    raise exception '자리번호를 입력하세요.';
  end if;
  if v_zone not in ('box_storage', 'picking') then
    raise exception '창고 구역이 올바르지 않습니다.';
  end if;

  select resolved.warehouse_id, resolved.company_id
    into v_warehouse_id, v_company_id
  from app.resolve_brand_warehouse(p_brand_id) as resolved;
  if v_warehouse_id is null or v_company_id is null then
    raise exception '브랜드 창고를 찾지 못했습니다.';
  end if;

  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  values (v_company_id, v_warehouse_id, v_code, v_zone)
  on conflict (warehouse_id, zone, code) do update
    set code = excluded.code
  returning id into v_location_id;

  perform public.touch_warehouse_registered_slot(
    v_warehouse_id,
    v_code,
    v_zone
  );

  return v_location_id;
end;
$$;

create or replace function app.insert_warehouse_box_movement(
  p_brand_id uuid,
  p_box_id uuid,
  p_action text,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_from_qty integer,
  p_to_qty integer,
  p_reason text default ''
)
returns void
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_from public.warehouse_locations;
  v_to public.warehouse_locations;
begin
  if p_from_location_id is not null then
    select * into v_from
    from public.warehouse_locations
    where id = p_from_location_id;
  end if;
  if p_to_location_id is not null then
    select * into v_to
    from public.warehouse_locations
    where id = p_to_location_id;
  end if;

  insert into public.warehouse_box_movements (
    brand_id,
    box_id,
    action,
    from_location_id,
    from_location_code,
    from_zone,
    to_location_id,
    to_location_code,
    to_zone,
    from_qty,
    to_qty,
    reason,
    actor_id
  )
  values (
    p_brand_id,
    p_box_id,
    p_action,
    p_from_location_id,
    v_from.code,
    v_from.zone,
    p_to_location_id,
    v_to.code,
    v_to.zone,
    p_from_qty,
    p_to_qty,
    coalesce(p_reason, ''),
    auth.uid()
  );
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
  new.status := app.warehouse_box_status(new.initial_qty, new.current_qty);

  select brand.company_id
    into v_brand_company
  from public.brands as brand
  where brand.id = new.brand_id;

  select loc.company_id, loc.warehouse_id
    into v_location_company, v_location_warehouse
  from public.warehouse_locations as loc
  where loc.id = new.location_id;

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

drop trigger if exists warehouse_boxes_enforce_boundaries
  on public.warehouse_boxes;
create trigger warehouse_boxes_enforce_boundaries
before insert or update on public.warehouse_boxes
for each row execute function public.enforce_warehouse_box_boundaries();

create or replace function public.create_warehouse_box(
  p_brand_id uuid,
  p_display_code text,
  p_style_id uuid,
  p_location_code text,
  p_zone text,
  p_received_on date,
  p_initial_qty integer,
  p_current_qty integer,
  p_usage_priority text default 'fifo',
  p_note text default '',
  p_source_position_id uuid default null
)
returns public.warehouse_boxes
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_box public.warehouse_boxes;
  v_location_id uuid;
  v_priority text;
  v_code text;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  v_code := upper(btrim(coalesce(p_display_code, '')));
  v_priority := coalesce(nullif(btrim(p_usage_priority), ''), 'fifo');
  if v_code = '' then
    raise exception '박스 고유번호를 입력하세요.';
  end if;
  if p_style_id is null then
    raise exception 'M번호를 선택하세요.';
  end if;
  if p_received_on is null then
    raise exception '입고일을 입력하세요.';
  end if;
  if p_initial_qty is null or p_initial_qty < 1 then
    raise exception '최초 입수는 1 이상의 정수로 입력하세요.';
  end if;
  if p_current_qty is null or p_current_qty < 0 then
    raise exception '현재 수량은 0 이상의 정수로 입력하세요.';
  end if;
  if p_current_qty > p_initial_qty then
    raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
  end if;
  if v_priority not in ('first', 'second', 'fifo', 'last') then
    raise exception '사용 순서가 올바르지 않습니다.';
  end if;

  v_location_id := app.ensure_warehouse_box_location(
    p_brand_id,
    p_location_code,
    p_zone
  );

  begin
    insert into public.warehouse_boxes (
      brand_id,
      set_id,
      display_code,
      location_id,
      style_id,
      received_on,
      initial_qty,
      current_qty,
      usage_priority,
      note,
      source_position_id,
      created_by
    )
    values (
      p_brand_id,
      null,
      v_code,
      v_location_id,
      p_style_id,
      p_received_on,
      p_initial_qty,
      p_current_qty,
      v_priority,
      coalesce(p_note, ''),
      p_source_position_id,
      auth.uid()
    )
    returning * into v_box;
  exception
    when unique_violation then
      raise exception '이미 등록된 박스 고유번호입니다.';
  end;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_box.id,
    'create',
    null,
    v_box.location_id,
    null,
    v_box.current_qty,
    '개별 박스 등록'
  );
  if v_box.status = 'opened' then
    perform app.insert_warehouse_box_movement(
      p_brand_id,
      v_box.id,
      'open',
      v_box.location_id,
      v_box.location_id,
      v_box.initial_qty,
      v_box.current_qty,
      '등록 시 개봉'
    );
  elsif v_box.status = 'depleted' then
    perform app.insert_warehouse_box_movement(
      p_brand_id,
      v_box.id,
      'deplete',
      v_box.location_id,
      v_box.location_id,
      v_box.initial_qty,
      v_box.current_qty,
      '등록 시 소진'
    );
  end if;

  return v_box;
end;
$$;

create or replace function public.update_warehouse_box(
  p_brand_id uuid,
  p_box_id uuid,
  p_current_qty integer default null,
  p_usage_priority text default null,
  p_note text default null
)
returns public.warehouse_boxes
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
  v_priority text;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;
  if p_current_qty is null
    and p_usage_priority is null
    and p_note is null then
    raise exception '수정할 값이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;

  if p_current_qty is not null then
    if p_current_qty < 0 then
      raise exception '현재 수량은 0 이상의 정수로 입력하세요.';
    end if;
    if p_current_qty > v_box.initial_qty then
      raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
    end if;
  end if;

  v_priority := coalesce(nullif(btrim(p_usage_priority), ''), v_box.usage_priority);
  if v_priority not in ('first', 'second', 'fifo', 'last') then
    raise exception '사용 순서가 올바르지 않습니다.';
  end if;

  update public.warehouse_boxes
  set
    current_qty = coalesce(p_current_qty, current_qty),
    usage_priority = v_priority,
    note = coalesce(p_note, note)
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'update',
    v_next.location_id,
    v_next.location_id,
    v_box.current_qty,
    v_next.current_qty,
    '개별 박스 수정'
  );
  if v_next.status is distinct from v_box.status then
    if v_next.status = 'opened' then
      perform app.insert_warehouse_box_movement(
        p_brand_id,
        v_next.id,
        'open',
        v_next.location_id,
        v_next.location_id,
        v_box.current_qty,
        v_next.current_qty,
        '수량 수정으로 개봉'
      );
    elsif v_next.status = 'depleted' then
      perform app.insert_warehouse_box_movement(
        p_brand_id,
        v_next.id,
        'deplete',
        v_next.location_id,
        v_next.location_id,
        v_box.current_qty,
        v_next.current_qty,
        '수량 수정으로 소진'
      );
    end if;
  end if;

  return v_next;
end;
$$;

create or replace function public.move_warehouse_box(
  p_brand_id uuid,
  p_box_id uuid,
  p_location_code text,
  p_zone text
)
returns public.warehouse_boxes
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
  v_location_id uuid;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;

  v_location_id := app.ensure_warehouse_box_location(
    p_brand_id,
    p_location_code,
    p_zone
  );
  if v_location_id = v_box.location_id then
    return v_box;
  end if;

  update public.warehouse_boxes
  set location_id = v_location_id
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'move',
    v_box.location_id,
    v_next.location_id,
    v_next.current_qty,
    v_next.current_qty,
    '개별 박스 자리 이동'
  );

  return v_next;
end;
$$;

create or replace function public.archive_warehouse_box(
  p_brand_id uuid,
  p_box_id uuid,
  p_reason text default ''
)
returns public.warehouse_boxes
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    return v_box;
  end if;

  update public.warehouse_boxes
  set
    archived_at = now(),
    archived_by = auth.uid()
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'archive',
    v_next.location_id,
    v_next.location_id,
    v_next.current_qty,
    v_next.current_qty,
    coalesce(nullif(btrim(p_reason), ''), '개별 박스 보관')
  );

  return v_next;
end;
$$;

comment on function public.create_warehouse_box(uuid, text, uuid, text, text, date, integer, integer, text, text, uuid) is
  '개별 박스 등록. 자리 upsert와 이력을 한 트랜잭션에서 처리한다. 묶음 재고는 건드리지 않는다.';
comment on function public.update_warehouse_box(uuid, uuid, integer, text, text) is
  '개별 박스 수량·순서·비고 수정. 상태는 수량으로 다시 계산한다.';
comment on function public.move_warehouse_box(uuid, uuid, text, text) is
  '개별 박스 자리·구역 이동. 묶음 재고 차감 없음.';
comment on function public.archive_warehouse_box(uuid, uuid, text) is
  '개별 박스 보관. hard delete 대신 archived_at을 채운다.';

revoke all on function app.warehouse_box_status(integer, integer) from public, anon;
revoke all on function app.resolve_brand_warehouse(uuid) from public, anon;
revoke all on function app.ensure_warehouse_box_location(uuid, text, text) from public, anon;
revoke all on function app.insert_warehouse_box_movement(uuid, uuid, text, uuid, uuid, integer, integer, text) from public, anon;
grant execute on function app.warehouse_box_status(integer, integer) to authenticated;
grant execute on function app.resolve_brand_warehouse(uuid) to authenticated;
grant execute on function app.ensure_warehouse_box_location(uuid, text, text) to authenticated;
grant execute on function app.insert_warehouse_box_movement(uuid, uuid, text, uuid, uuid, integer, integer, text) to authenticated;

revoke all on function public.create_warehouse_box(uuid, text, uuid, text, text, date, integer, integer, text, text, uuid)
  from public, anon;
revoke all on function public.update_warehouse_box(uuid, uuid, integer, text, text)
  from public, anon;
revoke all on function public.move_warehouse_box(uuid, uuid, text, text)
  from public, anon;
revoke all on function public.archive_warehouse_box(uuid, uuid, text)
  from public, anon;
grant execute on function public.create_warehouse_box(uuid, text, uuid, text, text, date, integer, integer, text, text, uuid)
  to authenticated;
grant execute on function public.update_warehouse_box(uuid, uuid, integer, text, text)
  to authenticated;
grant execute on function public.move_warehouse_box(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.archive_warehouse_box(uuid, uuid, text)
  to authenticated;
