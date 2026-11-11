alter table public.warehouse_room_list_folders
  add column revision integer not null default 0;

create or replace function app.prepare_warehouse_room_list_folder()
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

  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  else
    select coalesce(nullif(btrim(p.display_name), ''), '이름 미등록')
      into new.created_by_name
    from public.profiles p where p.id = new.created_by and p.status = 'active';
    if not found then
      raise exception 'Room list creator is unavailable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger prepare_warehouse_room_list_folder_update
before update on public.warehouse_room_list_folders
for each row execute function app.prepare_warehouse_room_list_folder();

grant update (title, items) on public.warehouse_room_list_folders to authenticated;
create policy room_list_folders_edit on public.warehouse_room_list_folders
  for update to authenticated
  using (created_by = (select auth.uid()) and app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id))
  with check (created_by = (select auth.uid()) and app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));
