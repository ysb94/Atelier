create function public.save_draft_colors(p_draft_id uuid, p_expected_updated_at timestamptz, p_colors jsonb)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_company uuid;
  v_brand uuid;
  v_updated_at timestamptz;
  v_ids uuid[];
  v_removed text[];
  v_choices jsonb;
  v_photos jsonb;
  v_change jsonb;
  v_color_key text;
begin
  if not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안 작성자만 컬러를 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_colors) is distinct from 'array' then
    raise exception '컬러 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_colors) > 9 then
    raise exception '최대 9컬러까지 추가할 수 있습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_colors) as item
    where nullif(item->>'id', '') is null or nullif(btrim(item->>'name'), '') is null
      or (item ? 'imageChoice' and (
        coalesce(item->>'imageChoice', '') not in ('Image', 'None')
        or (item->>'imageChoice' = 'Image' and (
          coalesce(length(item->>'photoUrl'), 0) > 98304
          or coalesce(item->>'photoUrl', '') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        ))
      ))
  ) then
    raise exception '컬러 이름 또는 사진을 확인해 주세요.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct (item->>'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(p_colors) as item;
  if cardinality(v_ids) <> jsonb_array_length(p_colors) then
    raise exception '컬러 목록에 중복된 항목이 있습니다.' using errcode = '22023';
  end if;

  select company_id, brand_id, updated_at into strict v_company, v_brand, v_updated_at
  from public.product_drafts where id = p_draft_id for update;
  if p_expected_updated_at is null or v_updated_at is distinct from p_expected_updated_at then
    raise exception '다른 곳에서 기획안을 수정했습니다. 컬러 문서를 다시 열어 주세요.' using errcode = '40001';
  end if;

  with removed as (
    delete from public.draft_colors where draft_id = p_draft_id and not (id = any(v_ids))
    returning id
  )
  select coalesce(array_agg(id::text), '{}') into v_removed from removed;

  update public.draft_colors as color
  set name = btrim(input.item->>'name'), sort_order = input.position
  from jsonb_array_elements(p_colors) with ordinality as input(item, position)
  where color.draft_id = p_draft_id and color.id = (input.item->>'id')::uuid
    and (color.name, color.sort_order) is distinct from (btrim(input.item->>'name'), input.position::integer);

  insert into public.draft_colors (id, company_id, brand_id, draft_id, name, sort_order)
  select (input.item->>'id')::uuid, v_company, v_brand, p_draft_id, btrim(input.item->>'name'), input.position
  from jsonb_array_elements(p_colors) with ordinality as input(item, position)
  where not exists (
    select 1 from public.draft_colors as color
    where color.draft_id = p_draft_id and color.id = (input.item->>'id')::uuid
  );

  if cardinality(v_removed) > 0 or exists (select 1 from jsonb_array_elements(p_colors) as item where item ? 'imageChoice') then
    select case when jsonb_typeof(specs->'colorImageChoices') = 'object' then specs->'colorImageChoices' else '{}'::jsonb end,
           case when jsonb_typeof(specs->'colorPhotoUrls') = 'object' then specs->'colorPhotoUrls' else '{}'::jsonb end
    into v_choices, v_photos from public.product_drafts where id = p_draft_id;
    v_choices := v_choices - v_removed;
    v_photos := v_photos - v_removed;
    for v_change in select item from jsonb_array_elements(p_colors) as item where item ? 'imageChoice' loop
      v_color_key := ((v_change->>'id')::uuid)::text;
      v_choices := v_choices || jsonb_build_object(v_color_key, v_change->>'imageChoice');
      if v_change->>'imageChoice' = 'Image' then
        v_photos := v_photos || jsonb_build_object(v_color_key, v_change->>'photoUrl');
      else
        v_photos := v_photos - v_color_key;
      end if;
    end loop;
    update public.product_drafts
    set specs = coalesce(specs, '{}'::jsonb) || jsonb_build_object('colorImageChoices', v_choices, 'colorPhotoUrls', v_photos),
        updated_at = now()
    where id = p_draft_id returning updated_at into v_updated_at;
  else
    update public.product_drafts set updated_at = now()
    where id = p_draft_id returning updated_at into v_updated_at;
  end if;
  return v_updated_at;
end
$$;

revoke all on function public.save_draft_colors(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_draft_colors(uuid, timestamptz, jsonb) to authenticated;
