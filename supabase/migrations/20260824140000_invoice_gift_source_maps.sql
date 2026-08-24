-- 사은품 원본 요청행 치환 매핑·후보 풀·멱등 배정 원장.
-- 기존 invoice_prefix_* / invoice_gift_* 캠페인(새 행 추가)은 변경하지 않는다.
-- 스냅샷(적용 전): requests 1 / items 7 / products 16 / quotas 0 / allocations 0
-- 파일: docs/backups/gift-prefix-pre-gift-source-map-20260824.xlsx

-- ---------------------------------------------------------------------------
-- 0) JS와 같은 UTF-8 FNV-1a 32비트. 균등 랜덤 타이브레이크용.
-- ---------------------------------------------------------------------------
create or replace function app.fnv1a_32_utf8(p_value text)
returns bigint
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  bytes bytea := convert_to(p_value, 'UTF8');
  hash bigint := 2166136261;
  i integer;
begin
  for i in 0 .. octet_length(bytes) - 1 loop
    hash := ((hash # get_byte(bytes, i)) * 16777619) & 4294967295;
  end loop;
  return hash;
end;
$$;

revoke all on function app.fnv1a_32_utf8(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) 쇼핑몰 + 원본 품목명 exact 매핑
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_gift_source_maps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  mall_name text not null
    check (length(btrim(mall_name)) > 0),
  normalized_mall_name text not null
    check (length(btrim(normalized_mall_name)) > 0),
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text not null
    check (length(btrim(normalized_product_name)) > 0),
  assignment_mode text not null
    check (assignment_mode in ('fixed', 'balanced_random')),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_gift_source_maps_brand_id_key
    unique (brand_id, id),
  constraint invoice_gift_source_maps_exact_key
    unique (brand_id, normalized_mall_name, normalized_product_name)
);

comment on table public.invoice_gift_source_maps is
  '원본 [사은품]/[증정] 요청행을 실제 M번호로 치환하는 exact 매핑. 캠페인형 사은품 추가와 분리한다.';
comment on column public.invoice_gift_source_maps.assignment_mode is
  'fixed: 후보 1종 고정. balanced_random: 누적 최소 후보 중 안정 해시로 균등 배정.';
comment on column public.invoice_gift_source_maps.normalized_mall_name is
  '앱 normalizeInvoiceText 결과. DB generated column을 쓰지 않는다.';

create index if not exists invoice_gift_source_maps_brand_active_idx
  on public.invoice_gift_source_maps (brand_id, is_active, updated_at desc);

create trigger invoice_gift_source_maps_set_updated_at
before update on public.invoice_gift_source_maps
for each row execute function public.set_updated_at();

alter table public.invoice_gift_source_maps enable row level security;

drop policy if exists invoice_gift_source_maps_all_member
  on public.invoice_gift_source_maps;
create policy invoice_gift_source_maps_all_member
on public.invoice_gift_source_maps
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_gift_source_maps
to authenticated;

-- ---------------------------------------------------------------------------
-- 2) 후보 M번호 풀
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_gift_source_map_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  map_id uuid not null,
  style_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_gift_source_map_products_brand_id_key
    unique (brand_id, id),
  constraint invoice_gift_source_map_products_map_style_key
    unique (map_id, style_id),
  constraint invoice_gift_source_map_products_map_fkey
    foreign key (brand_id, map_id)
    references public.invoice_gift_source_maps (brand_id, id)
    on delete cascade,
  constraint invoice_gift_source_map_products_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
);

comment on table public.invoice_gift_source_map_products is
  '사은품 원본행 매핑의 후보 M번호. 순서와 (map, style) 중복 방지를 유지한다.';

create index if not exists invoice_gift_source_map_products_map_idx
  on public.invoice_gift_source_map_products (brand_id, map_id, sort_order);

create index if not exists invoice_gift_source_map_products_style_idx
  on public.invoice_gift_source_map_products (brand_id, style_id);

create trigger invoice_gift_source_map_products_set_updated_at
before update on public.invoice_gift_source_map_products
for each row execute function public.set_updated_at();

alter table public.invoice_gift_source_map_products enable row level security;

drop policy if exists invoice_gift_source_map_products_all_member
  on public.invoice_gift_source_map_products;
create policy invoice_gift_source_map_products_all_member
on public.invoice_gift_source_map_products
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_gift_source_map_products
to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 스타일과 무관한 멱등 배정 원장
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_gift_source_allocations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  map_id uuid not null,
  style_id uuid not null,
  allocation_key text not null
    check (length(btrim(allocation_key)) > 0),
  order_fingerprint text not null
    check (length(btrim(order_fingerprint)) > 0),
  quantity_slot integer not null default 1
    check (quantity_slot > 0),
  mall_name text not null default '',
  customer_order_no text not null default '',
  ordered_at timestamp,
  source_file_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_gift_source_allocations_key_uidx
    unique (brand_id, allocation_key),
  constraint invoice_gift_source_allocations_map_fkey
    foreign key (brand_id, map_id)
    references public.invoice_gift_source_maps (brand_id, id)
    on delete cascade,
  constraint invoice_gift_source_allocations_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
);

comment on table public.invoice_gift_source_allocations is
  '사은품 원본행 수량 슬롯 배정. unique는 style과 무관한 allocation_key다. 수령인·전화·주소는 저장하지 않는다.';
comment on column public.invoice_gift_source_allocations.allocation_key is
  '주문 지문 + 쇼핑몰 + 원본 품목명 + 발생 순번 + 수량 슬롯. 후보 풀이 바뀌어도 재추첨하지 않는다.';

create index if not exists invoice_gift_source_allocations_map_idx
  on public.invoice_gift_source_allocations (brand_id, map_id, created_at);

create index if not exists invoice_gift_source_allocations_map_style_idx
  on public.invoice_gift_source_allocations (brand_id, map_id, style_id);

create index if not exists invoice_gift_source_allocations_fingerprint_idx
  on public.invoice_gift_source_allocations (brand_id, map_id, order_fingerprint);

create index if not exists invoice_gift_source_allocations_style_idx
  on public.invoice_gift_source_allocations (brand_id, style_id);

create trigger invoice_gift_source_allocations_set_updated_at
before update on public.invoice_gift_source_allocations
for each row execute function public.set_updated_at();

alter table public.invoice_gift_source_allocations enable row level security;

drop policy if exists invoice_gift_source_allocations_all_member
  on public.invoice_gift_source_allocations;
create policy invoice_gift_source_allocations_all_member
on public.invoice_gift_source_allocations
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_gift_source_allocations
to authenticated;

-- ---------------------------------------------------------------------------
-- 4) 부모 + 후보 풀 원자 저장
-- ---------------------------------------------------------------------------
create or replace function public.save_invoice_gift_source_map(
  p_brand_id uuid,
  p_mall_name text,
  p_normalized_mall_name text,
  p_product_name text,
  p_normalized_product_name text,
  p_assignment_mode text,
  p_style_ids uuid[],
  p_is_active boolean default true,
  p_note text default '',
  p_map_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_map_id uuid;
  v_style_id uuid;
  v_index integer := 0;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 원본행 매핑을 저장할 권한이 없습니다.';
  end if;
  if btrim(coalesce(p_mall_name, '')) = ''
    or btrim(coalesce(p_normalized_mall_name, '')) = ''
  then
    raise exception '쇼핑몰명을 입력하세요.';
  end if;
  if btrim(coalesce(p_product_name, '')) = ''
    or btrim(coalesce(p_normalized_product_name, '')) = ''
  then
    raise exception '원본 품목명을 입력하세요.';
  end if;
  if p_assignment_mode not in ('fixed', 'balanced_random') then
    raise exception '배정 방식이 올바르지 않습니다.';
  end if;
  if p_style_ids is null or cardinality(p_style_ids) = 0 then
    raise exception '후보 M번호를 한 개 이상 고르세요.';
  end if;
  if p_assignment_mode = 'fixed' and cardinality(p_style_ids) <> 1 then
    raise exception '고정 배정은 M번호 1개만 고를 수 있습니다.';
  end if;

  if p_map_id is not null then
    update public.invoice_gift_source_maps
    set
      mall_name = btrim(p_mall_name),
      normalized_mall_name = btrim(p_normalized_mall_name),
      product_name = btrim(p_product_name),
      normalized_product_name = btrim(p_normalized_product_name),
      assignment_mode = p_assignment_mode,
      is_active = coalesce(p_is_active, true),
      note = coalesce(p_note, '')
    where brand_id = p_brand_id
      and id = p_map_id
    returning id into v_map_id;
    if v_map_id is null then
      raise exception '사은품 원본행 매핑을 찾지 못했습니다.';
    end if;
  else
    insert into public.invoice_gift_source_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      assignment_mode,
      is_active,
      note
    )
    values (
      p_brand_id,
      btrim(p_mall_name),
      btrim(p_normalized_mall_name),
      btrim(p_product_name),
      btrim(p_normalized_product_name),
      p_assignment_mode,
      coalesce(p_is_active, true),
      coalesce(p_note, '')
    )
    on conflict (brand_id, normalized_mall_name, normalized_product_name)
    do update set
      mall_name = excluded.mall_name,
      product_name = excluded.product_name,
      assignment_mode = excluded.assignment_mode,
      is_active = excluded.is_active,
      note = excluded.note
    returning id into v_map_id;
  end if;

  delete from public.invoice_gift_source_map_products
  where brand_id = p_brand_id
    and map_id = v_map_id
    and not (style_id = any (p_style_ids));

  foreach v_style_id in array p_style_ids loop
    insert into public.invoice_gift_source_map_products (
      brand_id,
      map_id,
      style_id,
      sort_order
    )
    values (
      p_brand_id,
      v_map_id,
      v_style_id,
      v_index
    )
    on conflict (map_id, style_id)
    do update set sort_order = excluded.sort_order;
    v_index := v_index + 1;
  end loop;

  return v_map_id;
end;
$$;

revoke all on function public.save_invoice_gift_source_map(
  uuid, text, text, text, text, text, uuid[], boolean, text, uuid
) from public, anon;
grant execute on function public.save_invoice_gift_source_map(
  uuid, text, text, text, text, text, uuid[], boolean, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) 맵 잠금 후 기존 키 재사용 또는 균등 배정
-- ---------------------------------------------------------------------------
create or replace function public.assign_invoice_gift_source_rows(
  p_brand_id uuid,
  p_map_id uuid,
  p_requests jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_request jsonb;
  v_key text;
  v_fingerprint text;
  v_slot integer;
  v_mall text;
  v_order_no text;
  v_ordered_at timestamp;
  v_file text;
  v_existing uuid;
  v_style_id uuid;
  v_pool uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_style uuid;
  v_min integer;
  v_candidates uuid[] := array[]::uuid[];
  v_hash bigint;
  v_pick integer;
  v_result jsonb := '[]'::jsonb;
begin
  if p_brand_id is null or p_map_id is null then
    raise exception 'brand_id와 map_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 원본행을 배정할 권한이 없습니다.';
  end if;
  if p_requests is null or jsonb_typeof(p_requests) <> 'array' then
    raise exception '배정 요청 목록이 필요합니다.';
  end if;

  select m.assignment_mode
  into v_mode
  from public.invoice_gift_source_maps m
  where m.brand_id = p_brand_id
    and m.id = p_map_id
    and m.is_active
  for update;
  if v_mode is null then
    raise exception '활성 사은품 원본행 매핑을 찾지 못했습니다.';
  end if;

  select coalesce(array_agg(p.style_id order by p.sort_order, p.style_id), array[]::uuid[])
  into v_pool
  from public.invoice_gift_source_map_products p
  where p.brand_id = p_brand_id
    and p.map_id = p_map_id;
  if cardinality(v_pool) = 0 then
    raise exception '후보 M번호가 없습니다.';
  end if;
  if v_mode = 'fixed' and cardinality(v_pool) <> 1 then
    raise exception '고정 배정 매핑의 후보가 1개가 아닙니다.';
  end if;

  for v_style in
    select unnest(v_pool)
  loop
    select count(*)::integer
    into v_min
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.map_id = p_map_id
      and a.style_id = v_style;
    v_counts := jsonb_set(v_counts, array[v_style::text], to_jsonb(v_min));
  end loop;

  for v_request in
    select value
    from jsonb_array_elements(p_requests)
    order by value->>'allocation_key'
  loop
    v_key := btrim(coalesce(v_request->>'allocation_key', ''));
    v_fingerprint := btrim(coalesce(v_request->>'order_fingerprint', ''));
    v_slot := coalesce((v_request->>'quantity_slot')::integer, 1);
    v_mall := coalesce(v_request->>'mall_name', '');
    v_order_no := coalesce(v_request->>'customer_order_no', '');
    v_ordered_at := nullif(v_request->>'ordered_at', '')::timestamp;
    v_file := coalesce(v_request->>'source_file_name', '');
    if v_key = '' or v_fingerprint = '' then
      raise exception 'allocation_key와 order_fingerprint가 필요합니다.';
    end if;

    select a.style_id
    into v_existing
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.allocation_key = v_key;
    if v_existing is not null then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'allocation_key', v_key,
        'style_id', v_existing,
        'reused', true
      ));
      continue;
    end if;

    if v_mode = 'fixed' then
      v_style_id := v_pool[1];
    else
      v_min := null;
      v_candidates := array[]::uuid[];
      foreach v_style in array v_pool loop
        if v_min is null or (v_counts->>v_style::text)::integer < v_min then
          v_min := (v_counts->>v_style::text)::integer;
          v_candidates := array[v_style];
        elsif (v_counts->>v_style::text)::integer = v_min then
          v_candidates := array_append(v_candidates, v_style);
        end if;
      end loop;
      select array_agg(c order by c)
      into v_candidates
      from unnest(v_candidates) as c;
      v_hash := app.fnv1a_32_utf8(v_key);
      v_pick := (v_hash % cardinality(v_candidates))::integer + 1;
      v_style_id := v_candidates[v_pick];
    end if;

    insert into public.invoice_gift_source_allocations (
      brand_id,
      map_id,
      style_id,
      allocation_key,
      order_fingerprint,
      quantity_slot,
      mall_name,
      customer_order_no,
      ordered_at,
      source_file_name
    )
    values (
      p_brand_id,
      p_map_id,
      v_style_id,
      v_key,
      v_fingerprint,
      v_slot,
      v_mall,
      v_order_no,
      v_ordered_at,
      v_file
    );

    v_counts := jsonb_set(
      v_counts,
      array[v_style_id::text],
      to_jsonb((v_counts->>v_style_id::text)::integer + 1)
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'allocation_key', v_key,
      'style_id', v_style_id,
      'reused', false
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.assign_invoice_gift_source_rows(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.assign_invoice_gift_source_rows(uuid, uuid, jsonb)
  to authenticated;
