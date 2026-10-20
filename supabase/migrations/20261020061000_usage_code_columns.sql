-- 업체별 88코드 목록과 등록 양식이 같이 쓰는 헤더.
create table public.usage_code_columns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  system_key text
    check (
      system_key is null
      or system_key = any (array['code', 'name', 'status', 'productName', 'styleNo'])
    ),
  label text not null check (length(btrim(label)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_code_columns_brand_label_key unique (brand_id, label)
);

create index usage_code_columns_brand_idx
  on public.usage_code_columns (brand_id, sort_order);

create unique index usage_code_columns_brand_system_idx
  on public.usage_code_columns (brand_id, system_key)
  where system_key is not null;

create trigger usage_code_columns_set_updated_at
before update on public.usage_code_columns
for each row execute function public.set_updated_at();

alter table public.usage_code_columns enable row level security;

create policy usage_code_columns_select_member
on public.usage_code_columns
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy usage_code_columns_insert_editor
on public.usage_code_columns
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy usage_code_columns_update_editor
on public.usage_code_columns
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy usage_code_columns_delete_editor
on public.usage_code_columns
for delete
to authenticated
using (app.can_edit_brand(brand_id));

revoke all on public.usage_code_columns from anon;
grant select, insert, update, delete on public.usage_code_columns to authenticated;

create or replace function public.replace_usage_code_columns(
  p_brand_id uuid,
  p_columns jsonb
)
returns setof public.usage_code_columns
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_brand_id is null or not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 헤더를 수정할 권한이 없습니다.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(p_columns, '[]'::jsonb)) as item
    where item->>'systemKey' = 'code'
      and length(btrim(coalesce(item->>'label', ''))) > 0
  ) then
    raise exception '88코드 헤더는 빼지 마세요.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(p_columns, '[]'::jsonb)) as item
    where item->>'systemKey' = 'status'
      and length(btrim(coalesce(item->>'label', ''))) > 0
  ) then
    raise exception '상태 헤더는 빼지 마세요.';
  end if;

  delete from public.usage_code_columns
  where brand_id = p_brand_id;

  insert into public.usage_code_columns (id, brand_id, system_key, label, sort_order)
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
    p_brand_id,
    nullif(item->>'systemKey', ''),
    btrim(item->>'label'),
    coalesce((item->>'sortOrder')::integer, 0)
  from jsonb_array_elements(coalesce(p_columns, '[]'::jsonb)) as item;

  return query
  select *
  from public.usage_code_columns
  where brand_id = p_brand_id
  order by sort_order, label;
end;
$$;

revoke all on function public.replace_usage_code_columns(uuid, jsonb) from public, anon;
grant execute on function public.replace_usage_code_columns(uuid, jsonb) to authenticated;

insert into public.usage_code_columns (brand_id, system_key, label, sort_order)
select b.id, v.system_key, v.label, v.sort_order
from public.brands b
cross join (
  values
    ('code', '88코드', 0),
    ('name', '코드명', 1),
    ('status', '상태', 2),
    ('productName', '상품명', 3),
    ('styleNo', 'M번호', 4)
) as v(system_key, label, sort_order)
where not exists (
  select 1 from public.usage_code_columns c where c.brand_id = b.id
);
