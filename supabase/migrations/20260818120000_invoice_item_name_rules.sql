-- 내품명 변환 규칙을 품목명·옵션 조합 원장과 분리한다.
-- 공통 규칙은 본품을 보지 않고, 본품별 규칙은 확정된 styles.id로만 나눈다.

create table if not exists public.invoice_item_name_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  scope text not null
    check (scope in ('global', 'main_style')),
  main_style_id uuid,
  item_name text not null,
  normalized_item_name text not null,
  action text not null
    check (action in ('delete', 'components')),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_item_name_rules_brand_id_id_key unique (brand_id, id),
  constraint invoice_item_name_rules_scope_main_check check (
    (scope = 'global' and main_style_id is null)
    or (scope = 'main_style' and main_style_id is not null)
  ),
  constraint invoice_item_name_rules_main_style_fkey
    foreign key (brand_id, main_style_id)
    references public.styles (brand_id, id)
);

comment on table public.invoice_item_name_rules is
  '유효 내품명을 지우거나 출고 구성품 M번호로 연결하는 브랜드 규칙.';
comment on column public.invoice_item_name_rules.scope is
  'global=본품을 보지 않는 공통 규칙, main_style=확정 본품 M번호별 규칙.';
comment on column public.invoice_item_name_rules.item_name is
  '품목명 단계가 소비하고 남은 유효 내품명 원문.';
comment on column public.invoice_item_name_rules.action is
  'delete=내품명 빈칸, components=구성품 M번호로 연결하고 공식명을 내품명에 쓴다.';

create unique index if not exists invoice_item_name_rules_global_active_uidx
  on public.invoice_item_name_rules (brand_id, normalized_item_name)
  where is_active and scope = 'global';

create unique index if not exists invoice_item_name_rules_main_active_uidx
  on public.invoice_item_name_rules (brand_id, main_style_id, normalized_item_name)
  where is_active and scope = 'main_style';

create index if not exists invoice_item_name_rules_brand_item_idx
  on public.invoice_item_name_rules (brand_id, normalized_item_name)
  where is_active;

create trigger invoice_item_name_rules_set_updated_at
before update on public.invoice_item_name_rules
for each row execute function public.set_updated_at();

create table if not exists public.invoice_item_name_rule_components (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  rule_id uuid not null,
  style_id uuid not null,
  role text not null
    check (role in ('included', 'required', 'paid_add')),
  quantity integer not null default 1
    check (quantity >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_item_name_rule_components_rule_fkey
    foreign key (brand_id, rule_id)
    references public.invoice_item_name_rules (brand_id, id)
    on delete cascade,
  constraint invoice_item_name_rule_components_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_item_name_rule_components_rule_style_role_key
    unique (rule_id, style_id, role)
);

comment on table public.invoice_item_name_rule_components is
  '내품명 규칙이 추가하는 출고 구성품. 표시명은 styles.name을 조인한다.';

create index if not exists invoice_item_name_rule_components_rule_idx
  on public.invoice_item_name_rule_components (rule_id, sort_order);

create index if not exists invoice_item_name_rule_components_style_idx
  on public.invoice_item_name_rule_components (brand_id, style_id);

alter table public.invoice_item_name_rules enable row level security;
alter table public.invoice_item_name_rule_components enable row level security;

drop policy if exists invoice_item_name_rules_all_member
  on public.invoice_item_name_rules;
create policy invoice_item_name_rules_all_member
on public.invoice_item_name_rules
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_item_name_rule_components_all_member
  on public.invoice_item_name_rule_components;
create policy invoice_item_name_rule_components_all_member
on public.invoice_item_name_rule_components
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_item_name_rules
to authenticated;

grant select, insert, update, delete
on table public.invoice_item_name_rule_components
to authenticated;
