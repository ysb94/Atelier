-- 브랜드 항목 단일 선택 유형과 항목별 선택지.
-- 상품 값은 기존처럼 정규 선택명 문자열을 저장하고, 선택지는 별도 자식 테이블에서 관리한다.

create or replace function app.normalize_select_label(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select lower(btrim(regexp_replace(normalize(coalesce(value, ''), NFKC), '\s+', ' ', 'g')));
$$;

comment on function app.normalize_select_label(text) is
  '선택지 비교용 정규화. NFKC, 양끝 공백 제거, 연속 공백 축소, 소문자.';

revoke all on function app.normalize_select_label(text) from public, anon;
grant execute on function app.normalize_select_label(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_fields_brand_id_id_key'
      and conrelid = 'public.brand_fields'::regclass
  ) then
    alter table public.brand_fields
      add constraint brand_fields_brand_id_id_key unique (brand_id, id);
  end if;
end $$;

alter table public.brand_fields
  drop constraint if exists brand_fields_type_check;

alter table public.brand_fields
  add constraint brand_fields_type_check
  check (
    type = any (
      array[
        'text'::text,
        'number'::text,
        'list'::text,
        'gender'::text,
        'season'::text,
        'image'::text,
        'select'::text
      ]
    )
  );

create table if not exists public.brand_field_options (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  field_id uuid not null,
  label text not null
    check (length(btrim(label)) > 0),
  normalized_label text not null,
  aliases text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_field_options_brand_id_id_key unique (brand_id, id),
  constraint brand_field_options_field_fkey
    foreign key (brand_id, field_id)
    references public.brand_fields (brand_id, id)
    on delete cascade,
  constraint brand_field_options_label_key unique (
    brand_id,
    field_id,
    normalized_label
  )
);

comment on table public.brand_field_options is
  '브랜드 항목별 단일 선택 선택지. 삭제가 아니라 사용 중지가 기본이다.';
comment on column public.brand_field_options.label is
  '현재 표시명. 상품에는 이 문자열을 저장한다.';
comment on column public.brand_field_options.normalized_label is
  '필드 안 고유 비교 키. app.normalize_select_label(label).';
comment on column public.brand_field_options.aliases is
  '이전 표시명. 업로드·입력 시 현재 선택명으로 해석한다.';
comment on column public.brand_field_options.is_active is
  'false면 새 입력에 쓰지 않는다. 기존 상품 값은 유지한다.';

create index if not exists brand_field_options_field_sort_idx
  on public.brand_field_options (brand_id, field_id, sort_order, label);

create index if not exists brand_field_options_active_idx
  on public.brand_field_options (brand_id, field_id, sort_order)
  where is_active;

create or replace function public.brand_field_options_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.label := btrim(new.label);
  if new.label = '' then
    raise exception '선택지 이름을 입력하세요.';
  end if;
  new.normalized_label := app.normalize_select_label(new.label);
  if new.aliases is null then
    new.aliases := '{}';
  else
    new.aliases := coalesce(
      (
        select array_agg(distinct btrim(alias_value))
        from unnest(new.aliases) as alias_value
        where btrim(alias_value) <> ''
          and app.normalize_select_label(alias_value)
            is distinct from new.normalized_label
      ),
      '{}'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists brand_field_options_normalize on public.brand_field_options;
create trigger brand_field_options_normalize
before insert or update on public.brand_field_options
for each row execute function public.brand_field_options_normalize();

drop trigger if exists brand_field_options_set_updated_at on public.brand_field_options;
create trigger brand_field_options_set_updated_at
before update on public.brand_field_options
for each row execute function public.set_updated_at();

alter table public.brand_field_options enable row level security;

drop policy if exists brand_field_options_all_member
  on public.brand_field_options;
create policy brand_field_options_all_member
on public.brand_field_options
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.brand_field_options
to authenticated;

create or replace function public.save_brand_field_options(
  p_brand_id uuid,
  p_field_id uuid,
  p_options jsonb
)
returns setof public.brand_field_options
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type text;
  v_item jsonb;
  v_id uuid;
  v_label text;
  v_normalized text;
  v_aliases text[];
  v_sort integer;
  v_active boolean;
  v_existing_label text;
  v_keep uuid[] := '{}';
  v_seen text[] := '{}';
begin
  if p_brand_id is null or p_field_id is null then
    raise exception '항목을 지정하세요.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 선택지를 저장할 권한이 없습니다.';
  end if;

  select type into v_type
  from public.brand_fields
  where brand_id = p_brand_id
    and id = p_field_id;
  if v_type is null then
    raise exception '항목을 찾을 수 없습니다.';
  end if;
  if v_type <> 'select' then
    raise exception '선택형 항목만 선택지를 저장할 수 있습니다.';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception '선택지 목록이 올바르지 않습니다.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_options)
  loop
    v_label := btrim(coalesce(v_item->>'label', ''));
    if v_label = '' then
      raise exception '선택지 이름을 입력하세요.';
    end if;

    v_normalized := app.normalize_select_label(v_label);
    if v_normalized = any (v_seen) then
      raise exception '같은 이름의 선택지가 있습니다. (%)', v_label;
    end if;
    v_seen := array_append(v_seen, v_normalized);

    v_id := nullif(v_item->>'id', '')::uuid;
    v_sort := coalesce((v_item->>'sort_order')::integer, 0);
    v_active := coalesce((v_item->>'is_active')::boolean, true);
    v_aliases := coalesce(
      array(
        select distinct btrim(alias_value)
        from jsonb_array_elements_text(coalesce(v_item->'aliases', '[]'::jsonb)) as alias_value
        where btrim(alias_value) <> ''
          and app.normalize_select_label(alias_value) is distinct from v_normalized
      ),
      '{}'
    );

    if v_id is not null then
      select label into v_existing_label
      from public.brand_field_options
      where brand_id = p_brand_id
        and field_id = p_field_id
        and id = v_id;
      if v_existing_label is null then
        raise exception '선택지를 찾을 수 없습니다.';
      end if;
      if app.normalize_select_label(v_existing_label) is distinct from v_normalized
        and not exists (
          select 1
          from unnest(v_aliases) as alias_value
          where app.normalize_select_label(alias_value)
            = app.normalize_select_label(v_existing_label)
        )
      then
        v_aliases := array_append(v_aliases, v_existing_label);
      end if;

      update public.brand_field_options
      set
        label = v_label,
        aliases = v_aliases,
        sort_order = v_sort,
        is_active = v_active
      where brand_id = p_brand_id
        and field_id = p_field_id
        and id = v_id;
    else
      insert into public.brand_field_options (
        brand_id,
        field_id,
        label,
        aliases,
        sort_order,
        is_active
      )
      values (
        p_brand_id,
        p_field_id,
        v_label,
        v_aliases,
        v_sort,
        v_active
      )
      returning id into v_id;
    end if;

    v_keep := array_append(v_keep, v_id);
  end loop;

  update public.brand_field_options
  set is_active = false
  where brand_id = p_brand_id
    and field_id = p_field_id
    and (cardinality(v_keep) = 0 or not (id = any (v_keep)));

  return query
    select *
    from public.brand_field_options
    where brand_id = p_brand_id
      and field_id = p_field_id
    order by sort_order, label, id;
exception
  when unique_violation then
    raise exception '같은 이름의 선택지가 있습니다.';
end;
$$;

comment on function public.save_brand_field_options(uuid, uuid, jsonb) is
  '선택형 항목의 선택지를 한 트랜잭션에서 저장한다. 빠진 선택지는 삭제하지 않고 사용 중지한다.';

revoke all on function public.save_brand_field_options(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.save_brand_field_options(uuid, uuid, jsonb)
  to authenticated;
