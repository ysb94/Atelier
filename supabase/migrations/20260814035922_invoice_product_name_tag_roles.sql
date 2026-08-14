-- 품목명 맨 앞 [태그]의 브랜드별 역할 사전. 원문 품목명과 출고구성은 바꾸지 않는다.

create table if not exists public.invoice_product_name_tag_roles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  tag_text text not null
    check (length(btrim(tag_text)) > 0),
  normalized_tag text not null,
  role text not null
    check (role in (
      'event_marketing',
      'composition_gift',
      'identity_condition',
      'unknown'
    )),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_product_name_tag_roles_brand_id_id_key
    unique (brand_id, id),
  constraint invoice_product_name_tag_roles_tag_key
    unique (brand_id, normalized_tag)
);

comment on table public.invoice_product_name_tag_roles is
  '브랜드별 품목명 맨 앞 [태그] 역할 사전. 원문은 유지하고 상품 인식 후보만 조정한다.';
comment on column public.invoice_product_name_tag_roles.tag_text is
  '표시용 원문 태그. 예: [단독], [비치볼 증정]';
comment on column public.invoice_product_name_tag_roles.normalized_tag is
  '앱 normalizeInvoiceText와 같은 비교 키.';
comment on column public.invoice_product_name_tag_roles.role is
  'event_marketing·composition_gift는 인식 후보에서 제외. identity_condition·unknown은 유지. composition_gift는 출고구성을 바꾸지 않는다.';

create index if not exists invoice_product_name_tag_roles_brand_active_idx
  on public.invoice_product_name_tag_roles (brand_id)
  where is_active;

create trigger invoice_product_name_tag_roles_set_updated_at
before update on public.invoice_product_name_tag_roles
for each row execute function public.set_updated_at();

alter table public.invoice_product_name_tag_roles enable row level security;

drop policy if exists invoice_product_name_tag_roles_all_member
  on public.invoice_product_name_tag_roles;
create policy invoice_product_name_tag_roles_all_member
on public.invoice_product_name_tag_roles
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_product_name_tag_roles
to authenticated;
