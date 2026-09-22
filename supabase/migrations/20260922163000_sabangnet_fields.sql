-- 사방넷 엑셀 헤더. 사방넷 코드·상품명은 삭제할 수 없고, 추가 항목 값은
-- sabangnet_products.values 에 필드 id를 키로 둔다.

create table public.sabangnet_fields (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  system_key text check (system_key in ('code', 'name', 'styles')),
  type text not null default 'text' check (type in ('text', 'number')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sabangnet_fields_brand_label_key unique (brand_id, label),
  constraint sabangnet_fields_brand_system_key unique (brand_id, system_key)
);

comment on table public.sabangnet_fields is
  '사방넷 일괄 등록 엑셀의 헤더. 추가 항목 값은 sabangnet_products.values에 둔다.';

create index sabangnet_fields_brand_order_idx
  on public.sabangnet_fields (brand_id, sort_order, id);

drop trigger if exists sabangnet_fields_set_updated_at
  on public.sabangnet_fields;
create trigger sabangnet_fields_set_updated_at
before update on public.sabangnet_fields
for each row execute function public.set_updated_at();

alter table public.sabangnet_fields enable row level security;

create policy sabangnet_fields_select_member
on public.sabangnet_fields
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy sabangnet_fields_insert_editor
on public.sabangnet_fields
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy sabangnet_fields_update_editor
on public.sabangnet_fields
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy sabangnet_fields_delete_editor
on public.sabangnet_fields
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.sabangnet_fields
to authenticated;

insert into public.sabangnet_fields (brand_id, label, system_key, type, sort_order)
select
  brands.id,
  fields.label,
  fields.system_key,
  fields.type,
  fields.sort_order
from public.brands
cross join (
  values
    ('사방넷 코드', 'code', 'text', 0),
    ('사방넷 상품명', 'name', 'text', 1),
    ('M번호 리스트', 'styles', 'text', 2)
) as fields(label, system_key, type, sort_order)
on conflict (brand_id, system_key) do nothing;

alter table public.sabangnet_products
  add column if not exists values jsonb not null default '{}'::jsonb;

alter table public.sabangnet_products
  drop constraint if exists sabangnet_products_values_object;

alter table public.sabangnet_products
  add constraint sabangnet_products_values_object
  check (jsonb_typeof(values) = 'object');

comment on column public.sabangnet_products.values is
  '항목 관리에서 추가한 헤더 값. 키는 sabangnet_fields.id.';
