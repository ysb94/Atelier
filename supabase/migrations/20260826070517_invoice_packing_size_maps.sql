-- 데이터 시트의 택배 포장 규격 원문을 보존하면서 기준정보에서 간단 표시값만 관리한다.
-- 이번 단계에서는 송장 변환이나 출력에 이 매핑을 적용하지 않는다.

create table if not exists public.invoice_packing_size_maps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  field_id uuid not null,
  source_value text not null
    check (length(btrim(source_value)) > 0),
  normalized_source_value text not null
    check (length(btrim(normalized_source_value)) > 0),
  display_value text not null
    check (length(btrim(display_value)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_packing_size_maps_brand_id_id_key
    unique (brand_id, id),
  constraint invoice_packing_size_maps_field_fkey
    foreign key (brand_id, field_id)
    references public.brand_fields (brand_id, id)
    on delete cascade,
  constraint invoice_packing_size_maps_source_key
    unique (brand_id, field_id, normalized_source_value)
);

comment on table public.invoice_packing_size_maps is
  '택배 포장 규격 원문별 간단 표시값. styles 원본과 송장 출력은 변경하지 않는다.';
comment on column public.invoice_packing_size_maps.source_value is
  '데이터 시트에 보이는 대표 원문. 비교는 normalized_source_value를 사용한다.';
comment on column public.invoice_packing_size_maps.display_value is
  '기준정보에서 관리하는 간단 표시값. 아직 송장 변환과 출력에는 적용하지 않는다.';

create index if not exists invoice_packing_size_maps_field_idx
  on public.invoice_packing_size_maps (brand_id, field_id, source_value);

create or replace function public.invoice_packing_size_maps_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.source_value := btrim(new.source_value);
  new.normalized_source_value := app.normalize_select_label(new.source_value);
  new.display_value := btrim(new.display_value);
  if new.source_value = '' or new.normalized_source_value = '' then
    raise exception '원본 포장 규격을 입력하세요.';
  end if;
  if new.display_value = '' then
    raise exception '간단 표시값을 입력하세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_packing_size_maps_normalize
  on public.invoice_packing_size_maps;
create trigger invoice_packing_size_maps_normalize
before insert or update on public.invoice_packing_size_maps
for each row execute function public.invoice_packing_size_maps_normalize();

drop trigger if exists invoice_packing_size_maps_set_updated_at
  on public.invoice_packing_size_maps;
create trigger invoice_packing_size_maps_set_updated_at
before update on public.invoice_packing_size_maps
for each row execute function public.set_updated_at();

alter table public.invoice_packing_size_maps enable row level security;

drop policy if exists invoice_packing_size_maps_select_member
  on public.invoice_packing_size_maps;
create policy invoice_packing_size_maps_select_member
on public.invoice_packing_size_maps
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists invoice_packing_size_maps_insert_editor
  on public.invoice_packing_size_maps;
create policy invoice_packing_size_maps_insert_editor
on public.invoice_packing_size_maps
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_packing_size_maps_update_editor
  on public.invoice_packing_size_maps;
create policy invoice_packing_size_maps_update_editor
on public.invoice_packing_size_maps
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_packing_size_maps_delete_editor
  on public.invoice_packing_size_maps;
create policy invoice_packing_size_maps_delete_editor
on public.invoice_packing_size_maps
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_packing_size_maps
to authenticated;

create or replace function public.list_invoice_packing_size_source_values(
  p_brand_id uuid,
  p_field_id uuid
)
returns table (
  field_id uuid,
  source_value text,
  normalized_source_value text,
  style_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with target_field as (
    select field.id, field.brand_id, field.label
    from public.brand_fields as field
    where field.brand_id = p_brand_id
      and field.id = p_field_id
  ),
  source_rows as (
    select coalesce(
      nullif(btrim(style.values ->> target.id::text), ''),
      nullif(btrim(style.custom_fields ->> target.label), '')
    ) as raw_value
    from target_field as target
    join public.styles as style
      on style.brand_id = target.brand_id
  ),
  normalized_rows as (
    select
      raw_value,
      app.normalize_select_label(raw_value) as normalized_value
    from source_rows
    where raw_value is not null
  )
  select
    p_field_id,
    min(raw_value) as source_value,
    normalized_value as normalized_source_value,
    count(*) as style_count
  from normalized_rows
  where normalized_value <> ''
  group by normalized_value
  order by min(raw_value);
$$;

comment on function public.list_invoice_packing_size_source_values(uuid, uuid) is
  '브랜드 항목의 styles.values와 레거시 custom_fields를 합쳐 고유 포장 규격과 사용 상품 수를 읽는다.';

revoke all on function public.list_invoice_packing_size_source_values(uuid, uuid)
  from public, anon;
grant execute on function public.list_invoice_packing_size_source_values(uuid, uuid)
  to authenticated;

create or replace function public.save_invoice_packing_size_maps(
  p_brand_id uuid,
  p_field_id uuid,
  p_mappings jsonb
)
returns setof public.invoice_packing_size_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_source_value text;
  v_normalized_source_value text;
  v_display_value text;
begin
  if p_brand_id is null or p_field_id is null then
    raise exception '포장 규격 항목을 지정하세요.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 포장 규격 매핑을 저장할 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.brand_fields
    where brand_id = p_brand_id
      and id = p_field_id
  ) then
    raise exception '포장 규격 항목을 찾을 수 없습니다.';
  end if;
  if p_mappings is not null and jsonb_typeof(p_mappings) <> 'array' then
    raise exception '포장 규격 매핑 형식이 올바르지 않습니다.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_mappings, '[]'::jsonb))
  loop
    v_source_value := btrim(coalesce(v_item ->> 'source_value', ''));
    v_normalized_source_value := app.normalize_select_label(v_source_value);
    v_display_value := btrim(coalesce(v_item ->> 'display_value', ''));

    if v_source_value = '' or v_normalized_source_value = '' then
      raise exception '원본 포장 규격을 입력하세요.';
    end if;

    if v_display_value = '' then
      delete from public.invoice_packing_size_maps
      where brand_id = p_brand_id
        and field_id = p_field_id
        and normalized_source_value = v_normalized_source_value;
    else
      insert into public.invoice_packing_size_maps (
        brand_id,
        field_id,
        source_value,
        normalized_source_value,
        display_value
      )
      values (
        p_brand_id,
        p_field_id,
        v_source_value,
        v_normalized_source_value,
        v_display_value
      )
      on conflict (
        brand_id,
        field_id,
        normalized_source_value
      )
      do update set
        source_value = excluded.source_value,
        display_value = excluded.display_value;
    end if;
  end loop;

  return query
    select mapping.*
    from public.invoice_packing_size_maps as mapping
    where mapping.brand_id = p_brand_id
      and mapping.field_id = p_field_id
    order by mapping.source_value;
end;
$$;

comment on function public.save_invoice_packing_size_maps(uuid, uuid, jsonb) is
  '포장 규격 간단 표시값을 한 트랜잭션으로 저장한다. 빈 표시값은 해당 매핑만 지운다.';

revoke all on function public.save_invoice_packing_size_maps(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.save_invoice_packing_size_maps(uuid, uuid, jsonb)
  to authenticated;
