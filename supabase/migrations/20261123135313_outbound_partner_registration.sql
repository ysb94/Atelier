create function public.register_outbound_partner(
  p_brand_id uuid,
  p_action text,
  p_company_name text,
  p_site_name text,
  p_folder_id uuid,
  p_channel_type text,
  p_existing_id uuid,
  p_expected_updated_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.code_usage_targets%rowtype;
  v_group_id uuid;
  v_company_name text := btrim(regexp_replace(coalesce(p_company_name, ''), '[[:space:]]+', ' ', 'g'));
  v_site_name text := btrim(regexp_replace(coalesce(p_site_name, ''), '[[:space:]]+', ' ', 'g'));
  v_site_key text := app.outbound_partner_name_key(v_site_name);
  v_name text;
begin
  if p_brand_id is null or not coalesce(app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics', p_brand_id), false) then
    raise exception '이 브랜드의 출고업체를 등록할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('new-company', 'name-existing', 'add-site') then
    raise exception '등록 방식을 확인해 주세요.' using errcode = '22023';
  end if;
  if (p_action <> 'new-company' or v_site_name <> '') and v_site_key = '' then
    raise exception '지점명에 글자나 숫자를 입력해 주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('outbound-partner:' || p_brand_id::text, 0));

  if p_action = 'new-company' then
    if app.outbound_partner_name_key(v_company_name) = '' then
      raise exception '업체명에 글자나 숫자를 입력해 주세요.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.outbound_partner_groups g
       where g.brand_id = p_brand_id and g.normalized_name = app.outbound_partner_name_key(v_company_name)
    ) then
      raise exception '같은 이름의 업체가 이미 있습니다. 기존 업체를 선택해 주세요.' using errcode = '23505';
    end if;
    perform app.assert_outbound_partner_name_keys(
      p_brand_id, gen_random_uuid(),
      array[app.outbound_partner_name_key(v_company_name)], array[]::text[]
    );

    v_name := concat_ws(' ', v_company_name, nullif(v_site_name, ''));
    return public.save_outbound_partner_unit_atomic(
      p_brand_id, null, v_name, app.outbound_partner_name_key(v_name),
      p_channel_type, null, false, true, null, p_folder_id, null, v_company_name,
      v_site_name, v_site_key, '', '', '', '', '[]'::jsonb
    );
  end if;

  select t.* into v_existing from public.code_usage_targets t
   where t.id = p_existing_id and t.brand_id = p_brand_id and t.active
   for update;
  if not found then
    raise exception '등록할 업체를 다시 선택해 주세요.' using errcode = '40001';
  end if;
  if v_existing.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 곳에서 업체 정보가 변경됐습니다. 업체를 다시 선택해 주세요.' using errcode = '40001';
  end if;

  v_group_id := v_existing.group_id;
  if p_action = 'name-existing' and (
    v_existing.site_name <> '' or exists (
      select 1 from public.code_usage_targets t
       where t.brand_id = p_brand_id and t.group_id = v_group_id
         and t.folder_id is not distinct from v_existing.folder_id and t.site_name <> ''
    )
  ) then
    raise exception '이미 지점명이 있습니다. 새 지점으로 추가하거나 기존 지점에서 수정해 주세요.' using errcode = '40001';
  end if;

  if v_group_id is null then
    v_company_name := coalesce(nullif(regexp_replace(btrim(v_existing.name), ' (온라인|오프라인)$', ''), ''), v_existing.name);
    insert into public.outbound_partner_groups (brand_id, name, normalized_name, sort_order)
    select p_brand_id, v_company_name, app.outbound_partner_name_key(v_company_name), coalesce(max(g.sort_order) + 1, 0)
      from public.outbound_partner_groups g where g.brand_id = p_brand_id
    returning id into v_group_id;
  else
    select g.name into strict v_company_name from public.outbound_partner_groups g
     where g.id = v_group_id and g.brand_id = p_brand_id;
  end if;

  -- Preserve the existing unit and all links, including alias row IDs.
  if p_action = 'name-existing' then
    update public.code_usage_targets
       set group_id = v_group_id, site_name = v_site_name, normalized_site_name = v_site_key
     where id = v_existing.id and brand_id = p_brand_id;
    if not found then
      raise exception '기존 출고처를 수정할 권한이 없습니다.' using errcode = '42501';
    end if;
    return v_existing.id;
  end if;

  if v_existing.group_id is null then
    update public.code_usage_targets set group_id = v_group_id
     where id = v_existing.id and brand_id = p_brand_id;
    if not found then
      raise exception '기존 출고처를 수정할 권한이 없습니다.' using errcode = '42501';
    end if;
  end if;

  v_name := concat_ws(' ', v_company_name, v_site_name);
  return public.save_outbound_partner_unit_atomic(
    p_brand_id, null, v_name, app.outbound_partner_name_key(v_name),
    v_existing.channel_type, null, false, true, null, v_existing.folder_id,
    v_group_id, null, v_site_name, v_site_key, '', '', '', '', '[]'::jsonb
  );
end;
$$;

revoke all on function public.register_outbound_partner(uuid, text, text, text, uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.register_outbound_partner(uuid, text, text, text, uuid, text, uuid, timestamptz) to authenticated;
