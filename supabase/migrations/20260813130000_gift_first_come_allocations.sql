-- 사은품 선착순: M번호별 행사 배정수량 + 주문별 영속 배정 원장.
-- 스냅샷(적용 전): requests 1 / items 7 / products 16.

-- ---------------------------------------------------------------------------
-- 1) 요청 건에 선착순 사용 여부
-- ---------------------------------------------------------------------------
alter table public.invoice_prefix_requests
  add column if not exists uses_first_come boolean not null default false;

comment on column public.invoice_prefix_requests.uses_first_come is
  'true이면 invoice_gift_quotas 한도 안에서 주문일시 선착순으로 배정한다.';

-- ---------------------------------------------------------------------------
-- 2) M번호별 행사 배정수량
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_gift_quotas (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  request_id uuid not null,
  style_id uuid not null,
  quantity_limit integer not null
    check (quantity_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_gift_quotas_request_fkey
    foreign key (brand_id, request_id)
    references public.invoice_prefix_requests (brand_id, id)
    on delete cascade,
  constraint invoice_gift_quotas_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_gift_quotas_request_style_key
    unique (brand_id, request_id, style_id)
);

comment on table public.invoice_gift_quotas is
  '사은품 요청 건의 M번호별 선착순 행사 배정수량.';
comment on column public.invoice_gift_quotas.quantity_limit is
  '이 요청 건에서 해당 M번호를 최대 몇 개까지 나갈지.';

create index if not exists invoice_gift_quotas_request_idx
  on public.invoice_gift_quotas (brand_id, request_id);

create trigger invoice_gift_quotas_set_updated_at
before update on public.invoice_gift_quotas
for each row execute function public.set_updated_at();

alter table public.invoice_gift_quotas enable row level security;

drop policy if exists invoice_gift_quotas_all_member
  on public.invoice_gift_quotas;
create policy invoice_gift_quotas_all_member
on public.invoice_gift_quotas
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_gift_quotas
to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 주문별 사은품 배정 원장 (사은품 1개 = 1행)
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_gift_allocations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  request_id uuid not null,
  item_id uuid not null,
  style_id uuid not null,
  mall_name text not null default '',
  customer_order_no text not null default '',
  ordered_at timestamp,
  order_fingerprint text not null
    check (length(btrim(order_fingerprint)) > 0),
  allocation_key text not null
    check (length(btrim(allocation_key)) > 0),
  gift_slot_index integer not null default 1
    check (gift_slot_index > 0),
  source_file_name text not null default '',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_gift_allocations_request_fkey
    foreign key (brand_id, request_id)
    references public.invoice_prefix_requests (brand_id, id),
  constraint invoice_gift_allocations_item_fkey
    foreign key (brand_id, item_id)
    references public.invoice_prefix_items (brand_id, id),
  constraint invoice_gift_allocations_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_gift_allocations_request_key_uidx
    unique (brand_id, request_id, allocation_key)
);

comment on table public.invoice_gift_allocations is
  '사은품 1개 단위 영속 배정. 수령인·전화·주소는 저장하지 않는다.';
comment on column public.invoice_gift_allocations.order_fingerprint is
  '쇼핑몰+고객주문번호+주문일시 또는 주문번호 없을 때 비가역 지문.';
comment on column public.invoice_gift_allocations.allocation_key is
  '멱등 키. fingerprint + item + style + slot.';
comment on column public.invoice_gift_allocations.cancelled_at is
  '주문 취소로 해제된 시각. null이면 활성 배정.';

create index if not exists invoice_gift_allocations_request_active_idx
  on public.invoice_gift_allocations (brand_id, request_id)
  where cancelled_at is null;

create index if not exists invoice_gift_allocations_style_active_idx
  on public.invoice_gift_allocations (brand_id, request_id, style_id)
  where cancelled_at is null;

create index if not exists invoice_gift_allocations_fingerprint_idx
  on public.invoice_gift_allocations (brand_id, request_id, order_fingerprint);

create index if not exists invoice_gift_allocations_item_idx
  on public.invoice_gift_allocations (brand_id, item_id);

create trigger invoice_gift_allocations_set_updated_at
before update on public.invoice_gift_allocations
for each row execute function public.set_updated_at();

alter table public.invoice_gift_allocations enable row level security;

drop policy if exists invoice_gift_allocations_all_member
  on public.invoice_gift_allocations;
create policy invoice_gift_allocations_all_member
on public.invoice_gift_allocations
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_gift_allocations
to authenticated;

-- ---------------------------------------------------------------------------
-- 4) 원자 확정 RPC (security invoker + RLS)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_invoice_gift_allocations(
  p_brand_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate jsonb;
  v_request_ids uuid[] := array[]::uuid[];
  v_request_id uuid;
  v_item_id uuid;
  v_style_id uuid;
  v_mall_name text;
  v_customer_order_no text;
  v_ordered_at timestamp;
  v_fingerprint text;
  v_allocation_key text;
  v_slot integer;
  v_source_file text;
  v_existing public.invoice_gift_allocations%rowtype;
  v_limit integer;
  v_used integer;
  v_result jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 배정을 확정할 권한이 없습니다.';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception '배정 후보 목록이 필요합니다.';
  end if;

  for v_candidate in
    select value from jsonb_array_elements(p_candidates)
  loop
    v_request_id := (v_candidate->>'request_id')::uuid;
    if v_request_id is not null
      and not (v_request_id = any (v_request_ids))
    then
      v_request_ids := array_append(v_request_ids, v_request_id);
    end if;
  end loop;

  -- 요청 건을 잠가 동시 확정이 한도를 넘지 않게 한다.
  perform 1
  from public.invoice_prefix_requests r
  where r.brand_id = p_brand_id
    and r.id = any (v_request_ids)
  for update;

  for v_candidate in
    select value from jsonb_array_elements(p_candidates)
  loop
    v_request_id := (v_candidate->>'request_id')::uuid;
    v_item_id := (v_candidate->>'item_id')::uuid;
    v_style_id := (v_candidate->>'style_id')::uuid;
    v_mall_name := coalesce(v_candidate->>'mall_name', '');
    v_customer_order_no := coalesce(v_candidate->>'customer_order_no', '');
    v_fingerprint := btrim(coalesce(v_candidate->>'order_fingerprint', ''));
    v_allocation_key := btrim(coalesce(v_candidate->>'allocation_key', ''));
    v_slot := coalesce((v_candidate->>'gift_slot_index')::integer, 1);
    v_source_file := coalesce(v_candidate->>'source_file_name', '');

    if v_candidate ? 'ordered_at'
      and nullif(btrim(v_candidate->>'ordered_at'), '') is not null
    then
      v_ordered_at := (v_candidate->>'ordered_at')::timestamp;
    else
      v_ordered_at := null;
    end if;

    if v_request_id is null or v_item_id is null or v_style_id is null
      or v_fingerprint = '' or v_allocation_key = '' or v_slot < 1
    then
      raise exception '배정 후보에 필수값이 빠졌습니다.';
    end if;

    select *
    into v_existing
    from public.invoice_gift_allocations a
    where a.brand_id = p_brand_id
      and a.request_id = v_request_id
      and a.allocation_key = v_allocation_key;

    if found then
      if v_existing.cancelled_at is not null then
        v_skipped := v_skipped || jsonb_build_object(
          'allocation_key', v_allocation_key,
          'reason', 'cancelled'
        );
        continue;
      end if;
      v_result := v_result || jsonb_build_object(
        'id', v_existing.id,
        'request_id', v_existing.request_id,
        'item_id', v_existing.item_id,
        'style_id', v_existing.style_id,
        'mall_name', v_existing.mall_name,
        'customer_order_no', v_existing.customer_order_no,
        'ordered_at', to_char(v_existing.ordered_at, 'YYYY-MM-DD HH24:MI'),
        'order_fingerprint', v_existing.order_fingerprint,
        'allocation_key', v_existing.allocation_key,
        'gift_slot_index', v_existing.gift_slot_index,
        'reused', true
      );
      continue;
    end if;

    if not exists (
      select 1
      from public.invoice_prefix_requests r
      where r.brand_id = p_brand_id
        and r.id = v_request_id
    ) then
      raise exception '사은품 요청 건을 찾지 못했습니다.';
    end if;

    -- uses_first_come이 꺼져 있으면 원장에 넣지 않는다.
    if not exists (
      select 1
      from public.invoice_prefix_requests r
      where r.brand_id = p_brand_id
        and r.id = v_request_id
        and r.uses_first_come
    ) then
      v_skipped := v_skipped || jsonb_build_object(
        'allocation_key', v_allocation_key,
        'reason', 'first_come_disabled'
      );
      continue;
    end if;

    v_limit := null;
    select q.quantity_limit
    into v_limit
    from public.invoice_gift_quotas q
    where q.brand_id = p_brand_id
      and q.request_id = v_request_id
      and q.style_id = v_style_id;

    if v_limit is null then
      v_skipped := v_skipped || jsonb_build_object(
        'allocation_key', v_allocation_key,
        'reason', 'no_quota'
      );
      continue;
    end if;

    select count(*)::integer
    into v_used
    from public.invoice_gift_allocations a
    where a.brand_id = p_brand_id
      and a.request_id = v_request_id
      and a.style_id = v_style_id
      and a.cancelled_at is null;

    if v_used >= v_limit then
      v_skipped := v_skipped || jsonb_build_object(
        'allocation_key', v_allocation_key,
        'reason', 'quota_exhausted'
      );
      continue;
    end if;

    insert into public.invoice_gift_allocations (
      brand_id,
      request_id,
      item_id,
      style_id,
      mall_name,
      customer_order_no,
      ordered_at,
      order_fingerprint,
      allocation_key,
      gift_slot_index,
      source_file_name
    ) values (
      p_brand_id,
      v_request_id,
      v_item_id,
      v_style_id,
      v_mall_name,
      v_customer_order_no,
      v_ordered_at,
      v_fingerprint,
      v_allocation_key,
      v_slot,
      v_source_file
    )
    returning * into v_existing;

    v_result := v_result || jsonb_build_object(
      'id', v_existing.id,
      'request_id', v_existing.request_id,
      'item_id', v_existing.item_id,
      'style_id', v_existing.style_id,
      'mall_name', v_existing.mall_name,
      'customer_order_no', v_existing.customer_order_no,
      'ordered_at', to_char(v_existing.ordered_at, 'YYYY-MM-DD HH24:MI'),
      'order_fingerprint', v_existing.order_fingerprint,
      'allocation_key', v_existing.allocation_key,
      'gift_slot_index', v_existing.gift_slot_index,
      'reused', false
    );
  end loop;

  return jsonb_build_object(
    'allocations', v_result,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.confirm_invoice_gift_allocations(uuid, jsonb) is
  '선착순 사은품 배정을 원자적으로 확정한다. 기존 활성 배정은 재사용하고 취소된 키는 다시 쓰지 않는다.';

grant execute on function public.confirm_invoice_gift_allocations(uuid, jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- 5) 주문 단위 배정 취소 RPC
-- ---------------------------------------------------------------------------
create or replace function public.cancel_invoice_gift_allocations(
  p_brand_id uuid,
  p_request_id uuid,
  p_order_fingerprint text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_brand_id is null or p_request_id is null then
    raise exception 'brand_id와 request_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 배정을 취소할 권한이 없습니다.';
  end if;
  if btrim(coalesce(p_order_fingerprint, '')) = '' then
    raise exception 'order_fingerprint가 필요합니다.';
  end if;

  perform 1
  from public.invoice_prefix_requests r
  where r.brand_id = p_brand_id
    and r.id = p_request_id
  for update;

  update public.invoice_gift_allocations a
  set cancelled_at = now()
  where a.brand_id = p_brand_id
    and a.request_id = p_request_id
    and a.order_fingerprint = btrim(p_order_fingerprint)
    and a.cancelled_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.cancel_invoice_gift_allocations(uuid, uuid, text) is
  '주문 지문에 해당하는 활성 사은품 배정을 모두 취소한다.';

grant execute on function public.cancel_invoice_gift_allocations(uuid, uuid, text)
to authenticated;
