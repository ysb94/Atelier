-- 개별 박스는 임의 보관이 아니라 소진 또는 밀봉 박스 단위 출고로만 종료한다.
-- 기존 archived_at 행은 확인 필요 이력으로 보존하고 새 보관은 막는다.

alter table public.warehouse_boxes
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists completion_kind text;

alter table public.warehouse_boxes
  drop constraint if exists warehouse_boxes_completion_kind_check;
alter table public.warehouse_boxes
  add constraint warehouse_boxes_completion_kind_check
  check (
    (completed_at is null and completion_kind is null)
    or (
      completed_at is not null
      and completion_kind in ('depleted', 'box_outbound')
      and current_qty = 0
    )
  );

comment on column public.warehouse_boxes.completed_at is
  '소진 또는 박스 단위 출고로 종료한 시각. 임의 보관(archived_at)과 구분한다.';
comment on column public.warehouse_boxes.completed_by is
  '소진 또는 박스 단위 출고를 확정한 작업자.';
comment on column public.warehouse_boxes.completion_kind is
  'depleted: 출고창고 낱개 수량 0. box_outbound: 밀봉 박스 통째 출고.';
comment on column public.warehouse_boxes.archived_at is
  '과거 임의 보관 시각. 새 보관은 막고 확인 필요 이력으로만 읽는다.';

create index if not exists warehouse_boxes_brand_open_idx
  on public.warehouse_boxes (brand_id, created_at desc)
  where archived_at is null and completed_at is null;

alter table public.warehouse_box_movements
  drop constraint if exists warehouse_box_movements_action_check;
alter table public.warehouse_box_movements
  add constraint warehouse_box_movements_action_check
  check (action in (
    'create',
    'update',
    'move',
    'open',
    'deplete',
    'archive',
    'box_outbound'
  ));

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

  if tg_op = 'UPDATE'
    and old.archived_at is null
    and new.archived_at is not null then
    raise exception '보관 처리는 더 이상 사용할 수 없습니다. 소진 또는 박스 출고로 종료하세요.';
  end if;

  if tg_op = 'UPDATE' and old.archived_at is not null then
    if new.archived_at is distinct from old.archived_at
      or new.completed_at is distinct from old.completed_at
      or new.completion_kind is distinct from old.completion_kind
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

  if tg_op = 'UPDATE' and old.completed_at is not null then
    if new.completed_at is distinct from old.completed_at
      or new.completed_by is distinct from old.completed_by
      or new.completion_kind is distinct from old.completion_kind
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '종료된 박스는 수정할 수 없습니다.';
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
    and new.current_qty <> new.initial_qty
    and new.completion_kind is distinct from 'box_outbound' then
    raise exception '박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.';
  end if;

  new.status := app.warehouse_box_status(new.initial_qty, new.current_qty);

  if new.completed_at is not null then
    if new.current_qty <> 0 then
      raise exception '종료된 박스의 현재 수량은 0이어야 합니다.';
    end if;
    if new.completion_kind not in ('depleted', 'box_outbound') then
      raise exception '종료 종류가 올바르지 않습니다.';
    end if;
  end if;

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
  '개별 박스의 브랜드·자리·수량 경계와 소진·박스 출고 종료 규칙을 강제한다.';

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
  v_code text;
  v_priority text;
  v_location_id uuid;
  v_box public.warehouse_boxes;
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
    update public.warehouse_boxes
    set
      completed_at = now(),
      completed_by = auth.uid(),
      completion_kind = 'depleted'
    where id = v_box.id
      and brand_id = p_brand_id
    returning * into v_box;
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
  if v_box.completed_at is not null then
    raise exception '종료된 박스는 수정할 수 없습니다.';
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

  if v_next.status = 'depleted' and v_next.completed_at is null then
    update public.warehouse_boxes
    set
      completed_at = now(),
      completed_by = auth.uid(),
      completion_kind = 'depleted'
    where id = v_next.id
      and brand_id = p_brand_id
    returning * into v_next;
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
  if v_box.completed_at is not null then
    raise exception '종료된 박스는 수정할 수 없습니다.';
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

create or replace function public.complete_warehouse_box_outbound(
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
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;
  if v_box.completed_at is not null then
    return v_box;
  end if;
  if v_box.current_qty <> v_box.initial_qty or v_box.status <> 'sealed' then
    raise exception '개봉된 박스는 박스 단위로 출고할 수 없습니다. 남은 수량을 0으로 소진하세요.';
  end if;
  if v_box.current_qty <= 0 then
    raise exception '출고할 수량이 없습니다.';
  end if;

  update public.warehouse_boxes
  set
    current_qty = 0,
    completed_at = now(),
    completed_by = auth.uid(),
    completion_kind = 'box_outbound'
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'box_outbound',
    v_next.location_id,
    v_next.location_id,
    v_box.current_qty,
    0,
    coalesce(nullif(btrim(p_reason), ''), '밀봉 박스 단위 출고')
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
begin
  raise exception '보관 처리는 더 이상 사용할 수 없습니다. 소진 또는 박스 출고로 종료하세요.';
end;
$$;

comment on function public.create_warehouse_box(uuid, text, uuid, text, text, date, integer, integer, text, text, uuid) is
  '개별 박스 등록. 등록 수량이 0이면 소진으로 종료한다.';
comment on function public.update_warehouse_box(uuid, uuid, integer, text, text) is
  '개별 박스 수량·순서·비고 수정. 수량이 0이 되면 소진으로 종료한다.';
comment on function public.move_warehouse_box(uuid, uuid, text, text) is
  '개별 박스 자리·구역 이동. 종료된 박스는 이동할 수 없다.';
comment on function public.complete_warehouse_box_outbound(uuid, uuid, text) is
  '밀봉 박스를 통째로 출고하고 수량을 0으로 종료한다.';
comment on function public.archive_warehouse_box(uuid, uuid, text) is
  '폐기. 새 보관은 허용하지 않으며 소진 또는 박스 출고를 사용한다.';

revoke all on function public.archive_warehouse_box(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_warehouse_box_outbound(uuid, uuid, text)
  from public, anon;
grant execute on function public.complete_warehouse_box_outbound(uuid, uuid, text)
  to authenticated;
