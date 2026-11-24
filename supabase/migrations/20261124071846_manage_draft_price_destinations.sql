create function app.draft_price_preset_name(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_key
    when '중국' then 'CHINA (김웅사장님)'
    when 'CN-EXT' then 'CHINA (외부 업체)'
    when '한국' then 'KOREA'
    when 'PROMOTION [중국]' then 'PROMOTION [중국]'
    when 'other' then '기타 제조처'
  end
$$;

alter table public.draft_price_destinations
  add column preset_key text,
  add column removed_at timestamptz,
  add column revision uuid not null default gen_random_uuid(),
  add constraint draft_price_destination_preset_key_check
    check (preset_key is null or app.draft_price_preset_name(preset_key) is not null),
  add unique (company_id, preset_key),
  drop constraint draft_price_destinations_company_id_normalized_name_key,
  drop constraint draft_price_destinations_reserved_check,
  add constraint draft_price_destinations_reserved_check check (
    normalized_name not in ('china (김웅사장님)', 'china (외부 업체)', 'china', '중국', 'korea', '한국',
      'promotion [중국]', 'promotion [china]', '기타 제조처')
    or (preset_key is not null and normalized_name = lower(app.draft_price_preset_name(preset_key)))
  );

create unique index draft_price_destinations_active_name_idx
  on public.draft_price_destinations(company_id, normalized_name) where removed_at is null;

-- Existing clients still read active, user-created entries through the table.
alter policy draft_price_destinations_company_read on public.draft_price_destinations
  using (company_id = (select app.permission_company_id()) and preset_key is null and removed_at is null);
grant select (revision) on public.draft_price_destinations to authenticated;

create function app.draft_price_destination_json(p_row public.draft_price_destinations) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id, 'name', p_row.name, 'preset_key', p_row.preset_key,
    'removed', p_row.removed_at is not null, 'revision', p_row.revision
  )
$$;

create function app.list_draft_price_destinations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app.draft_price_destination_json(d) order by d.name, d.id), '[]'::jsonb)
  from public.draft_price_destinations d
  where (select auth.uid()) is not null and d.company_id = (select app.permission_company_id())
    and (d.removed_at is null or d.preset_key is not null)
$$;

create function app.change_draft_price_destination(p_draft uuid, p_option text, p_revision uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_preset text := app.draft_price_preset_name(p_option);
  v_id uuid;
  v_removed_at timestamptz := case when p_name is null then now() end;
  v_row public.draft_price_destinations;
begin
  if auth.uid() is null or v_company is null or not app.draft_write_allowed(p_draft) then
    raise exception '공용 제조국 목록을 변경할 권한이 없습니다.' using errcode = '42501';
  end if;
  if v_preset is null then
    if p_option is null or p_option !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      raise exception '제조국을 확인해 주세요.' using errcode = '22023';
    end if;
    v_id := p_option::uuid;
  end if;

  if v_preset is not null and p_revision is null then
    insert into public.draft_price_destinations(company_id, source_draft_id, preset_key, name, removed_at)
    values (v_company, p_draft, p_option, coalesce(p_name, v_preset), v_removed_at)
    on conflict (company_id, preset_key) do nothing
    returning * into v_row;
  else
    update public.draft_price_destinations d
    set name = coalesce(p_name, d.name), removed_at = v_removed_at, revision = gen_random_uuid()
    where d.company_id = v_company and d.revision = p_revision
      and (d.preset_key = p_option or (d.id = v_id and d.preset_key is null and d.removed_at is null))
    returning d.* into v_row;
  end if;

  if not found then
    raise exception '다른 화면에서 목록을 변경했습니다.' using errcode = '40001';
  end if;
  return app.draft_price_destination_json(v_row);
end
$$;

create function public.list_draft_price_destinations() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select app.list_draft_price_destinations()
$$;

create function public.change_draft_price_destination(p_draft uuid, p_option text, p_revision uuid, p_name text) returns jsonb
language sql security invoker set search_path = '' as $$
  select app.change_draft_price_destination(p_draft, p_option, p_revision, p_name)
$$;

revoke all on function app.draft_price_preset_name(text), app.draft_price_destination_json(public.draft_price_destinations),
  app.list_draft_price_destinations(), app.change_draft_price_destination(uuid, text, uuid, text),
  public.list_draft_price_destinations(), public.change_draft_price_destination(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app.draft_price_preset_name(text),
  app.list_draft_price_destinations(), app.change_draft_price_destination(uuid, text, uuid, text),
  public.list_draft_price_destinations(), public.change_draft_price_destination(uuid, text, uuid, text)
  to authenticated;
