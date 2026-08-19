-- 내품명 부속품 인식 사전. 행마다 규칙을 쌓지 않고 라벨·색상·어휘만 관리한다.
-- 인식 결과는 저장하지 않고 매 파일마다 다시 계산한다.

create table if not exists public.invoice_accessory_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  rule_type text not null
    check (rule_type in ('label', 'color', 'token', 'ignore', 'default')),
  pattern text not null
    check (length(btrim(pattern)) > 0),
  normalized_pattern text not null
    check (length(btrim(normalized_pattern)) > 0),
  accessory_kind text not null default '',
  name_prefix text not null default '',
  color_name text not null default '',
  target_style_id uuid references public.styles(id) on delete restrict,
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_accessory_rules_brand_id_id_key
    unique (brand_id, id),
  constraint invoice_accessory_rules_type_fields_check
    check (
      (
        rule_type in ('label', 'default')
        and length(btrim(accessory_kind)) > 0
        and length(btrim(name_prefix)) > 0
        and target_style_id is null
        and length(btrim(color_name)) = 0
      )
      or (
        rule_type = 'color'
        and length(btrim(color_name)) > 0
        and target_style_id is null
        and length(btrim(accessory_kind)) = 0
        and length(btrim(name_prefix)) = 0
      )
      or (
        rule_type = 'token'
        and target_style_id is not null
        and length(btrim(accessory_kind)) = 0
        and length(btrim(name_prefix)) = 0
        and length(btrim(color_name)) = 0
      )
      or (
        rule_type = 'ignore'
        and target_style_id is null
        and length(btrim(accessory_kind)) = 0
        and length(btrim(name_prefix)) = 0
        and length(btrim(color_name)) = 0
      )
    )
);

comment on table public.invoice_accessory_rules is
  '내품명 부속품 인식 사전. 라벨·색상·어휘·본품 기본 종류만 두고 인식 결과는 저장하지 않는다.';
comment on column public.invoice_accessory_rules.rule_type is
  'label=라벨 별칭→종류, color=색상 별칭, token=문구→M번호, ignore=버릴 조각, default=라벨 없을 때 본품 기준 종류.';
comment on column public.invoice_accessory_rules.pattern is
  '표시용 원문. 비교는 normalized_pattern.';
comment on column public.invoice_accessory_rules.normalized_pattern is
  '앱 normalizeInvoiceText와 같은 비교 키.';
comment on column public.invoice_accessory_rules.accessory_kind is
  '표시용 부속품 종류. 예: 태슬, 숄더스트랩.';
comment on column public.invoice_accessory_rules.name_prefix is
  'styles.name 조회 접두어. 예: `태슬 - `, `컬러스트랩 `.';
comment on column public.invoice_accessory_rules.color_name is
  '한글 색상. styles.name의 접두어 뒤에 붙인다.';
comment on column public.invoice_accessory_rules.target_style_id is
  'token 규칙이 가리키는 구성품 styles.id.';

create unique index if not exists invoice_accessory_rules_active_uidx
  on public.invoice_accessory_rules (brand_id, rule_type, normalized_pattern)
  where is_active;

create index if not exists invoice_accessory_rules_brand_active_idx
  on public.invoice_accessory_rules (brand_id)
  where is_active;

create index if not exists invoice_accessory_rules_target_style_idx
  on public.invoice_accessory_rules (target_style_id)
  where target_style_id is not null;

create trigger invoice_accessory_rules_set_updated_at
before update on public.invoice_accessory_rules
for each row execute function public.set_updated_at();

alter table public.invoice_accessory_rules enable row level security;

drop policy if exists invoice_accessory_rules_all_member
  on public.invoice_accessory_rules;
create policy invoice_accessory_rules_all_member
on public.invoice_accessory_rules
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_accessory_rules
to authenticated;
