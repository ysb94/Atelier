create table public.draft_folder_row_orders (
  season_id uuid primary key references public.seasons(id) on delete cascade,
  draft_ids uuid[] not null check (cardinality(draft_ids) >= 2),
  revision uuid not null default gen_random_uuid()
);

alter table public.draft_folder_row_orders enable row level security;
revoke all on public.draft_folder_row_orders from public, anon, authenticated;
grant select on public.draft_folder_row_orders to authenticated;

create policy draft_folder_row_orders_brand_read on public.draft_folder_row_orders
  for select to authenticated using (
    exists (
      select 1 from public.seasons s
      join public.brands b on b.id = s.brand_id
      where s.id = draft_folder_row_orders.season_id and s.code <> 'UNASSIGNED'
        and b.company_id = (select app.permission_company_id()) and app.can_read_brand(b.id)
    )
  );

create function app.save_draft_folder_row_order(p_folder uuid, p_draft_ids uuid[], p_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_brand uuid;
  v_saved public.draft_folder_row_orders;
  v_current_ids uuid[];
begin
  select s.brand_id into v_brand from public.seasons s
  join public.brands b on b.id = s.brand_id
  where s.id = p_folder and s.code <> 'UNASSIGNED' and b.company_id = v_company
  for key share of s;

  if auth.uid() is null or v_brand is null
    or not coalesce(app.can_read_brand(v_brand) and
      (app.basic_work_allowed('planning', v_brand) or app.can_edit_brand(v_brand)), false) then
    raise exception '해당 폴더의 기획안 순서를 변경할 권한이 없습니다.' using errcode = '42501';
  end if;
  if array_ndims(p_draft_ids) is distinct from 1 or cardinality(p_draft_ids) < 2 then
    raise exception '이동할 기획안 목록을 확인해 주세요.' using errcode = '22023';
  end if;

  select array_agg(d.id order by d.id) into v_current_ids
  from public.product_drafts d
  where d.season_id = p_folder and d.brand_id = v_brand and d.company_id = v_company;
  if v_current_ids is distinct from array(select id from unnest(p_draft_ids) id order by id) then
    raise exception '폴더의 기획안 목록이 변경되었습니다.' using errcode = '40001';
  end if;

  if p_revision is null then
    insert into public.draft_folder_row_orders (season_id, draft_ids) values (p_folder, p_draft_ids)
    on conflict (season_id) do nothing returning * into v_saved;
  else
    update public.draft_folder_row_orders
    set draft_ids = p_draft_ids, revision = gen_random_uuid()
    where season_id = p_folder and revision = p_revision returning * into v_saved;
  end if;
  if v_saved.season_id is null then
    raise exception '다른 화면에서 기획안 순서를 변경했습니다.' using errcode = '40001';
  end if;
  return to_jsonb(v_saved);
end
$$;

create function public.save_draft_folder_row_order(p_folder uuid, p_draft_ids uuid[], p_revision uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.save_draft_folder_row_order(p_folder, p_draft_ids, p_revision)
$$;

revoke all on function app.save_draft_folder_row_order(uuid, uuid[], uuid),
  public.save_draft_folder_row_order(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function app.save_draft_folder_row_order(uuid, uuid[], uuid),
  public.save_draft_folder_row_order(uuid, uuid[], uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.draft_folder_row_orders;
  end if;
end
$$;
