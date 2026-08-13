-- 송장·접두어에서 상품 연결을 이름 문자열이 아니라 styles(M번호) 참조로 바꾼다.
-- 표시 이름은 읽을 때 styles.name을 조인해서 쓰고, target_name / outgoing_product_names는
-- 스냅샷·하위호환용으로 잠시 남긴다.

-- ---------------------------------------------------------------------------
-- 1) invoice_name_rules: target_style_id
-- ---------------------------------------------------------------------------
alter table public.invoice_name_rules
  add column if not exists target_style_id uuid;

comment on column public.invoice_name_rules.target_style_id is
  '공식 상품 연결. styles.id(M번호 행). rename일 때 필수.';
comment on column public.invoice_name_rules.target_name is
  '표시용 캐시. 진짜 연결은 target_style_id이며 이름은 읽을 때 styles에서 가져온다.';

-- 기존 rename 규칙을 상품명 exact-match로 백필 (사전 확인: 전부 1:1)
update public.invoice_name_rules r
set target_style_id = s.id
from public.styles s
where r.action = 'rename'
  and r.target_style_id is null
  and coalesce(btrim(r.target_name), '') <> ''
  and s.brand_id = r.brand_id
  and lower(btrim(s.name)) = lower(btrim(r.target_name));

do $$
declare
  unmatched integer;
begin
  select count(*) into unmatched
  from public.invoice_name_rules
  where action = 'rename'
    and target_style_id is null;
  if unmatched > 0 then
    raise exception
      'invoice_name_rules rename 백필 실패: target_style_id 없는 행 %건',
      unmatched;
  end if;
end $$;

alter table public.invoice_name_rules
  drop constraint if exists invoice_name_rules_target_style_fkey;

alter table public.invoice_name_rules
  add constraint invoice_name_rules_target_style_fkey
  foreign key (brand_id, target_style_id)
  references public.styles (brand_id, id);

alter table public.invoice_name_rules
  drop constraint if exists invoice_name_rules_rename_style_check;

alter table public.invoice_name_rules
  add constraint invoice_name_rules_rename_style_check
  check (action <> 'rename' or target_style_id is not null);

create index if not exists invoice_name_rules_target_style_idx
  on public.invoice_name_rules (brand_id, target_style_id)
  where target_style_id is not null;

-- ---------------------------------------------------------------------------
-- 2) invoice_prefix_items: 자식 표용 unique + 랜덤 배열 체크 제거
-- ---------------------------------------------------------------------------
alter table public.invoice_prefix_items
  drop constraint if exists invoice_prefix_items_brand_id_key;

alter table public.invoice_prefix_items
  add constraint invoice_prefix_items_brand_id_key unique (brand_id, id);

alter table public.invoice_prefix_items
  drop constraint if exists invoice_prefix_items_random_check;

comment on column public.invoice_prefix_items.outgoing_product_names is
  'deprecated. 실제 연결은 invoice_prefix_item_products.style_id. 검증 후 드롭 예정.';

-- ---------------------------------------------------------------------------
-- 3) invoice_prefix_item_products
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_prefix_item_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  item_id uuid not null,
  style_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_prefix_item_products_item_fkey
    foreign key (brand_id, item_id)
    references public.invoice_prefix_items (brand_id, id)
    on delete cascade,
  constraint invoice_prefix_item_products_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_prefix_item_products_item_style_key
    unique (item_id, style_id)
);

comment on table public.invoice_prefix_item_products is
  '접두어 항목에 나가는 사은품 제품. styles(M번호)를 가리킨다.';
comment on column public.invoice_prefix_item_products.style_id is
  '나가는 제품. styles.id. 이름은 읽을 때 styles.name을 쓴다.';

create index if not exists invoice_prefix_item_products_item_idx
  on public.invoice_prefix_item_products (item_id, sort_order);

create index if not exists invoice_prefix_item_products_style_idx
  on public.invoice_prefix_item_products (brand_id, style_id);

-- 기존 outgoing_product_names 배열을 이름 exact-match로 이관
insert into public.invoice_prefix_item_products (
  brand_id,
  item_id,
  style_id,
  sort_order
)
select
  i.brand_id,
  i.id,
  s.id,
  x.ord::integer - 1
from public.invoice_prefix_items i
cross join lateral unnest(i.outgoing_product_names) with ordinality as x(name, ord)
join public.styles s
  on s.brand_id = i.brand_id
 and lower(btrim(s.name)) = lower(btrim(x.name))
where coalesce(btrim(x.name), '') <> ''
on conflict (item_id, style_id) do nothing;

do $$
declare
  expected integer;
  actual integer;
begin
  select coalesce(sum(cardinality(outgoing_product_names)), 0)
  into expected
  from public.invoice_prefix_items;

  select count(*) into actual
  from public.invoice_prefix_item_products;

  if actual < expected then
    raise exception
      'invoice_prefix_item_products 백필 부족: 기대 %건, 실제 %건',
      expected, actual;
  end if;
end $$;

alter table public.invoice_prefix_item_products enable row level security;

drop policy if exists invoice_prefix_item_products_all_member
  on public.invoice_prefix_item_products;

create policy invoice_prefix_item_products_all_member
on public.invoice_prefix_item_products
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_prefix_item_products
to authenticated;
