create table public.warehouse_room_list_folders (
  id uuid primary key,
  brand_id uuid not null references public.brands(id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  item_count integer generated always as (jsonb_array_length(items)) stored,
  created_by uuid not null default auth.uid(),
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create index warehouse_room_list_folders_history_idx
  on public.warehouse_room_list_folders (brand_id, created_at desc, id desc);

create function app.prepare_warehouse_room_list_folder()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'Invalid room list items' using errcode = '22023';
  end if;
  if jsonb_array_length(new.items) = 0 or exists (
    select from jsonb_array_elements(new.items) as entry(item)
    where case when jsonb_typeof(item) <> 'array' then true
      else jsonb_array_length(item) <> 2
        or jsonb_typeof(item->0) is distinct from 'string'
        or btrim(item->>0) = ''
        or jsonb_typeof(item->1) is distinct from 'string'
        or (item->>1 <> '' and item->>1 !~ '^[+-]?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)([.][0-9]+)?$')
      end
  ) then
    raise exception 'Invalid room list items' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), '이름 미등록')
    into new.created_by_name
  from public.profiles p where p.id = new.created_by and p.status = 'active';
  if not found then
    raise exception 'Room list creator is unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.prepare_warehouse_room_list_folder() from public, anon, authenticated;

create trigger prepare_warehouse_room_list_folder
before insert on public.warehouse_room_list_folders
for each row execute function app.prepare_warehouse_room_list_folder();

alter table public.warehouse_room_list_folders enable row level security;
revoke all on public.warehouse_room_list_folders from public, anon, authenticated;
grant select on public.warehouse_room_list_folders to authenticated;
grant insert (id, brand_id, title, items) on public.warehouse_room_list_folders to authenticated;

create policy room_list_folders_read on public.warehouse_room_list_folders
  for select to authenticated using (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));
create policy room_list_folders_create on public.warehouse_room_list_folders
  for insert to authenticated with check (
    created_by = (select auth.uid()) and app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id)
  );
