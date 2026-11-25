create table public.draft_folder_orders (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  folder_ids uuid[] not null check (cardinality(folder_ids) >= 2),
  revision uuid not null default gen_random_uuid()
);

alter table public.draft_folder_orders enable row level security;
revoke all on public.draft_folder_orders from public, anon, authenticated;
grant select on public.draft_folder_orders to authenticated;

create policy draft_folder_orders_brand_read on public.draft_folder_orders
  for select to authenticated using (
    app.can_read_brand(brand_id) and exists (
      select 1 from public.brands b
      where b.id = draft_folder_orders.brand_id and b.company_id = (select app.permission_company_id())
    )
  );

create function app.save_draft_folder_order(p_brand uuid, p_folder_ids uuid[], p_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_saved public.draft_folder_orders;
  v_current_ids uuid[];
begin
  if auth.uid() is null or v_company is null
    or not exists (select 1 from public.brands b where b.id = p_brand and b.company_id = v_company)
    or not coalesce(app.basic_work_allowed('planning', p_brand) or app.can_edit_brand(p_brand), false) then
    raise exception '해당 브랜드의 폴더 순서를 변경할 권한이 없습니다.' using errcode = '42501';
  end if;
  if array_ndims(p_folder_ids) is distinct from 1 or cardinality(p_folder_ids) < 2 then
    raise exception '이동할 폴더 목록을 확인해 주세요.' using errcode = '22023';
  end if;

  select array_agg(s.id order by s.id) into v_current_ids
  from public.seasons s where s.brand_id = p_brand and s.code <> 'UNASSIGNED';
  if v_current_ids is distinct from array(select id from unnest(p_folder_ids) id order by id) then
    raise exception '폴더 목록이 변경되었습니다. 최신 목록을 확인해 주세요.' using errcode = '40001';
  end if;

  if p_revision is null then
    insert into public.draft_folder_orders (brand_id, folder_ids) values (p_brand, p_folder_ids)
    on conflict (brand_id) do nothing returning * into v_saved;
  else
    update public.draft_folder_orders
    set folder_ids = p_folder_ids, revision = gen_random_uuid()
    where brand_id = p_brand and revision = p_revision returning * into v_saved;
  end if;
  if v_saved.brand_id is null then
    raise exception '다른 화면에서 폴더 순서를 변경했습니다.' using errcode = '40001';
  end if;
  return to_jsonb(v_saved);
end
$$;

create function public.save_draft_folder_order(p_brand uuid, p_folder_ids uuid[], p_revision uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.save_draft_folder_order(p_brand, p_folder_ids, p_revision)
$$;

revoke all on function app.save_draft_folder_order(uuid, uuid[], uuid),
  public.save_draft_folder_order(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function app.save_draft_folder_order(uuid, uuid[], uuid),
  public.save_draft_folder_order(uuid, uuid[], uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.draft_folder_orders;
  end if;
end
$$;
