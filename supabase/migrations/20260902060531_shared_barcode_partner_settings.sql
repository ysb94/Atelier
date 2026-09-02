-- 브랜드 구성원이 함께 쓰는 대량출고 양식과 바코드 화면 업체 표시 설정.
-- 기존 업무 행은 수정하지 않는 additive migration이다.

create table public.bulk_outbound_template_fields (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  usage_target_id uuid not null,
  barcode_source text not null
    check (barcode_source = any (array['own'::text, 'partner'::text])),
  field_key text not null
    check (length(btrim(field_key)) between 1 and 200),
  label text not null
    check (length(btrim(label)) between 1 and 120),
  sort_order integer not null default 0
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_outbound_template_fields_brand_id_id_key
    unique (brand_id, id),
  constraint bulk_outbound_template_fields_group_key_key
    unique (brand_id, usage_target_id, barcode_source, field_key),
  constraint bulk_outbound_template_fields_group_label_key
    unique (brand_id, usage_target_id, barcode_source, label),
  constraint bulk_outbound_template_fields_group_order_key
    unique (brand_id, usage_target_id, barcode_source, sort_order),
  constraint bulk_outbound_template_fields_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id)
    on delete cascade
);

comment on table public.bulk_outbound_template_fields is
  '대량출고 업체·바코드 출처별 엑셀 헤더. 같은 브랜드 구성원이 공유한다.';

create index bulk_outbound_template_fields_group_idx
  on public.bulk_outbound_template_fields (
    brand_id,
    usage_target_id,
    barcode_source,
    sort_order
  );

create trigger bulk_outbound_template_fields_set_updated_at
before update on public.bulk_outbound_template_fields
for each row execute function public.set_updated_at();

alter table public.bulk_outbound_template_fields enable row level security;

create policy bulk_outbound_template_fields_all_member
on public.bulk_outbound_template_fields
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.bulk_outbound_template_fields
to authenticated;

create table public.barcode_partner_display_settings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  display_scope text not null
    check (display_scope = any (array['own'::text, 'partner'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barcode_partner_display_settings_brand_id_id_key
    unique (brand_id, id),
  constraint barcode_partner_display_settings_brand_scope_key
    unique (brand_id, display_scope)
);

comment on table public.barcode_partner_display_settings is
  '출고업체별 바코드(own)·거래처 코드(partner) 화면의 브랜드 공용 설정 여부.';

create trigger barcode_partner_display_settings_set_updated_at
before update on public.barcode_partner_display_settings
for each row execute function public.set_updated_at();

alter table public.barcode_partner_display_settings enable row level security;

create policy barcode_partner_display_settings_all_member
on public.barcode_partner_display_settings
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.barcode_partner_display_settings
to authenticated;

create table public.barcode_partner_display_targets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  setting_id uuid not null,
  usage_target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint barcode_partner_display_targets_brand_id_id_key
    unique (brand_id, id),
  constraint barcode_partner_display_targets_setting_target_key
    unique (setting_id, usage_target_id),
  constraint barcode_partner_display_targets_setting_fkey
    foreign key (brand_id, setting_id)
    references public.barcode_partner_display_settings (brand_id, id)
    on delete cascade,
  constraint barcode_partner_display_targets_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id)
    on delete cascade
);

comment on table public.barcode_partner_display_targets is
  '바코드 화면별 표시 업체. 부모 설정 행이 있어 빈 선택도 공용 상태로 구분한다.';

create index barcode_partner_display_targets_setting_idx
  on public.barcode_partner_display_targets (brand_id, setting_id);

alter table public.barcode_partner_display_targets enable row level security;

create policy barcode_partner_display_targets_all_member
on public.barcode_partner_display_targets
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.barcode_partner_display_targets
to authenticated;

create or replace function public.replace_bulk_outbound_template_fields(
  p_brand_id uuid,
  p_usage_target_id uuid,
  p_barcode_source text,
  p_fields jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  field jsonb;
  field_count integer;
  field_order integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_barcode_source not in ('own', 'partner') then
    raise exception '올바르지 않은 바코드 출처입니다.';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception '양식 헤더 배열이 필요합니다.';
  end if;

  field_count := jsonb_array_length(p_fields);
  if field_count < 1 or field_count > 100 then
    raise exception '양식 헤더는 1개 이상 100개 이하로 저장하세요.';
  end if;

  if not exists (
    select 1
    from public.code_usage_targets
    where brand_id = p_brand_id
      and id = p_usage_target_id
  ) then
    raise exception '같은 브랜드의 출고업체를 찾지 못했습니다.';
  end if;

  delete from public.bulk_outbound_template_fields
  where brand_id = p_brand_id
    and usage_target_id = p_usage_target_id
    and barcode_source = p_barcode_source;

  for field in select value from jsonb_array_elements(p_fields)
  loop
    if length(btrim(coalesce(field->>'id', ''))) not between 1 and 200 then
      raise exception '양식 헤더 식별자가 올바르지 않습니다.';
    end if;
    if length(btrim(coalesce(field->>'label', ''))) not between 1 and 120 then
      raise exception '양식 헤더 이름이 올바르지 않습니다.';
    end if;

    insert into public.bulk_outbound_template_fields (
      brand_id,
      usage_target_id,
      barcode_source,
      field_key,
      label,
      sort_order
    ) values (
      p_brand_id,
      p_usage_target_id,
      p_barcode_source,
      btrim(field->>'id'),
      btrim(field->>'label'),
      field_order
    );

    field_order := field_order + 1;
  end loop;
end;
$function$;

revoke all on function public.replace_bulk_outbound_template_fields(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon;
grant execute on function public.replace_bulk_outbound_template_fields(
  uuid,
  uuid,
  text,
  jsonb
) to authenticated;

create or replace function public.replace_barcode_partner_display_targets(
  p_brand_id uuid,
  p_display_scope text,
  p_usage_target_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_setting_id uuid;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_display_scope not in ('own', 'partner') then
    raise exception '올바르지 않은 업체 표시 범위입니다.';
  end if;

  insert into public.barcode_partner_display_settings (
    brand_id,
    display_scope
  ) values (
    p_brand_id,
    p_display_scope
  )
  on conflict (brand_id, display_scope)
  do update set updated_at = now()
  returning id into v_setting_id;

  delete from public.barcode_partner_display_targets
  where brand_id = p_brand_id
    and setting_id = v_setting_id;

  insert into public.barcode_partner_display_targets (
    brand_id,
    setting_id,
    usage_target_id
  )
  select
    p_brand_id,
    v_setting_id,
    target_id
  from (
    select distinct unnest(coalesce(p_usage_target_ids, '{}'::uuid[])) as target_id
  ) selected;
end;
$function$;

revoke all on function public.replace_barcode_partner_display_targets(
  uuid,
  text,
  uuid[]
) from public, anon;
grant execute on function public.replace_barcode_partner_display_targets(
  uuid,
  text,
  uuid[]
) to authenticated;
