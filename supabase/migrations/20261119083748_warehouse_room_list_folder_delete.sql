grant delete on public.warehouse_room_list_folders to authenticated;

create policy room_list_folders_delete on public.warehouse_room_list_folders
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    and app.basic_work_allowed('logistics', brand_id)
    and app.can_read_brand(brand_id)
  );
