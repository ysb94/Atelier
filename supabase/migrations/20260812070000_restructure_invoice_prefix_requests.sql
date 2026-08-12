-- 접두어는 사은품 증정 요청 건(캠페인) 단위로 들어온다.
-- 제목·업무번호·쇼핑몰·행사 기간을 부모에 두고 상품명 1:1 접두어를 자식에 담는다.
-- 이전 평면 테이블은 실사용 데이터가 없어 그대로 지운다.
drop table if exists public.invoice_prefix_rules;

create table public.invoice_prefix_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null
    check (length(btrim(title)) > 0),
  task_no text not null default '',
  mall_name text not null
    check (length(btrim(mall_name)) > 0),
  normalized_mall_name text generated always as (
    lower(regexp_replace(btrim(mall_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_prefix_requests_period_check check (ends_on >= starts_on),
  constraint invoice_prefix_requests_brand_id_key unique (brand_id, id)
);

comment on table public.invoice_prefix_requests is
  '쇼핑몰 사은품 증정 요청 건. 행사 기간 안의 주문에만 접두어를 붙인다.';
comment on column public.invoice_prefix_requests.task_no is
  '요청서 업무번호. 원본 문서를 다시 찾기 위한 참고값이다.';
comment on column public.invoice_prefix_requests.starts_on is
  '행사 시작일. 사방넷 주문일시가 이 날짜 이후인 행만 대상이다.';
comment on column public.invoice_prefix_requests.ends_on is
  '행사 종료일. 기간이 지나면 접두어를 붙이지 않는다.';

create table public.invoice_prefix_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  request_id uuid not null,
  channel_product_no text not null default '',
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text generated always as (
    lower(regexp_replace(btrim(product_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  prefix text not null
    check (length(btrim(prefix)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_prefix_items_request_fkey
    foreign key (brand_id, request_id)
    references public.invoice_prefix_requests (brand_id, id)
    on delete cascade
);

comment on table public.invoice_prefix_items is
  '요청 건 안의 상품명 1:1 접두어. 사방넷 원본 품목명과 완전 일치로 찾는다.';
comment on column public.invoice_prefix_items.channel_product_no is
  '요청서의 채널상품번호. 사방넷 필수 열에 없어 매칭에는 쓰지 않고 확인용으로 둔다.';
comment on column public.invoice_prefix_items.product_name is
  '요청서 상품명. 사방넷 품목명과 글자까지 같아야 매칭된다.';

create index invoice_prefix_requests_period_idx
  on public.invoice_prefix_requests (brand_id, starts_on, ends_on)
  where is_active;

create unique index invoice_prefix_items_product_uidx
  on public.invoice_prefix_items (request_id, normalized_product_name);

create index invoice_prefix_items_brand_product_idx
  on public.invoice_prefix_items (brand_id, normalized_product_name);

create trigger invoice_prefix_requests_set_updated_at
before update on public.invoice_prefix_requests
for each row execute function public.set_updated_at();

create trigger invoice_prefix_items_set_updated_at
before update on public.invoice_prefix_items
for each row execute function public.set_updated_at();

alter table public.invoice_prefix_requests enable row level security;
alter table public.invoice_prefix_items enable row level security;

create policy invoice_prefix_requests_all_member
on public.invoice_prefix_requests
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy invoice_prefix_items_all_member
on public.invoice_prefix_items
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_prefix_requests
to authenticated;

grant select, insert, update, delete
on table public.invoice_prefix_items
to authenticated;
