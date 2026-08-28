-- 바코드 사용처를 출고업체 기준으로 넓힌다.
-- 업체명 문자열에 섞여 있던 판매 성격·출고 방식을 각각 열로 분리하고,
-- 부서·발주 사이트마다 다르게 부르는 이름을 별칭으로 연결한다.
-- 기존 `active` 이력 보존 의미와 바코드 연결(code_usage_assignments)은 바꾸지 않는다.

alter table public.code_usage_targets
  add column if not exists normalized_name text not null default '',
  add column if not exists channel_type text not null default 'unset',
  add column if not exists shipping_method text not null default 'unset',
  add column if not exists is_one_time boolean not null default false,
  add column if not exists note text not null default '';

comment on column public.code_usage_targets.normalized_name is
  '이름 비교용 압축 키. 앱 compactOutboundPartnerKey가 넣는다.';
comment on column public.code_usage_targets.channel_type is
  '판매 성격. 출고 방식과 독립된 축이며 unset은 아직 정하지 않음.';
comment on column public.code_usage_targets.shipping_method is
  '출고 방식. 업체명에 붙이지 않고 이 열로만 구분한다.';
comment on column public.code_usage_targets.is_one_time is
  '단발성 거래. active와 조합해 거래중·단발성·보관 세 상태를 만든다.';

alter table public.code_usage_targets
  drop constraint if exists code_usage_targets_channel_type_check;
alter table public.code_usage_targets
  add constraint code_usage_targets_channel_type_check
  check (channel_type = any (array['unset', 'online', 'offline']));

alter table public.code_usage_targets
  drop constraint if exists code_usage_targets_shipping_method_check;
alter table public.code_usage_targets
  add constraint code_usage_targets_shipping_method_check
  check (
    shipping_method = any (
      array['unset', 'parcel', 'fulfillment', 'freight', 'pickup']
    )
  );

-- 기존 행의 비교 키를 채운다. 앱 압축 키와 같은 규칙이며 이름 값은 바꾸지 않는다.
update public.code_usage_targets
set normalized_name = lower(regexp_replace(name, '[^0-9A-Za-z가-힣]', '', 'g'))
where normalized_name = '';

-- 이름 자체는 원문 unique를 유지하고, 띄어쓰기만 다른 중복은 압축 키로 막는다.
create unique index if not exists code_usage_targets_brand_normalized_name_key
  on public.code_usage_targets (brand_id, normalized_name)
  where normalized_name <> '';

-- 부서·발주 사이트마다 다르게 부르는 이름. 정식명 1건에 별칭 N건이다.
create table if not exists public.code_usage_target_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  target_id uuid not null,
  alias text not null
    check (length(btrim(alias)) > 0),
  normalized_alias text not null
    check (length(normalized_alias) > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint code_usage_target_aliases_brand_id_id_key unique (brand_id, id),
  constraint code_usage_target_aliases_brand_alias_key
    unique (brand_id, normalized_alias),
  constraint code_usage_target_aliases_target_fkey
    foreign key (brand_id, target_id)
    references public.code_usage_targets (brand_id, id) on delete cascade
);

comment on table public.code_usage_target_aliases is
  '출고업체 별칭. 원문을 보존하고 조회·중복 판정은 normalized_alias로 한다.';
comment on column public.code_usage_target_aliases.normalized_alias is
  '브랜드 안에서 유일하다. 한 별칭이 두 업체를 가리키지 못하게 막는다.';

create index if not exists code_usage_target_aliases_target_idx
  on public.code_usage_target_aliases (brand_id, target_id);

drop trigger if exists code_usage_target_aliases_set_updated_at
  on public.code_usage_target_aliases;
create trigger code_usage_target_aliases_set_updated_at
before update on public.code_usage_target_aliases
for each row execute function public.set_updated_at();

alter table public.code_usage_target_aliases enable row level security;

drop policy if exists code_usage_target_aliases_all_member
  on public.code_usage_target_aliases;
create policy code_usage_target_aliases_all_member
on public.code_usage_target_aliases
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.code_usage_target_aliases
to authenticated;
