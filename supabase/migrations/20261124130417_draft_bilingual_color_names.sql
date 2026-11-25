-- Use the existing COLOR transaction and permissions for rows, photos and revision checks.
create function public.save_draft_colors_with_names(p_draft_id uuid, p_expected_updated_at timestamptz, p_colors jsonb)
returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  v_colors jsonb;
  v_names jsonb;
  v_revision timestamptz;
begin
  if jsonb_typeof(p_colors) is distinct from 'array' then
    raise exception '컬러 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_colors) > 9 then
    raise exception '최대 9컬러까지 추가할 수 있습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_colors) item
    where jsonb_typeof(item->'nameEn') is distinct from 'string'
      or jsonb_typeof(item->'nameKo') is distinct from 'string'
      or nullif(btrim(item->>'id'), '') is null
      or (btrim(item->>'nameEn') = '' and btrim(item->>'nameKo') = '')
  ) then
    raise exception '컬러 영문 또는 한글명을 입력하세요.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row.item || jsonb_build_object('name', coalesce(nullif(row.name_ko, ''), row.name_en)) order by row.position), '[]'::jsonb),
         coalesce(jsonb_object_agg((row.item->>'id')::uuid::text, jsonb_build_object('nameEn', row.name_en, 'nameKo', row.name_ko)), '{}'::jsonb)
    into v_colors, v_names
  from (
    select input.item, input.position, btrim(input.item->>'nameEn') as name_en, btrim(input.item->>'nameKo') as name_ko
    from jsonb_array_elements(p_colors) with ordinality input(item, position)
  ) row;

  perform public.save_draft_colors(p_draft_id, p_expected_updated_at, v_colors);
  update public.product_drafts
    set specs = coalesce(specs, '{}'::jsonb) || jsonb_build_object('colorNames', v_names)
    where id = p_draft_id
    returning updated_at into v_revision;
  if not found then
    raise exception '컬러 이름을 저장할 권한이 없습니다.' using errcode = '42501';
  end if;
  return v_revision;
end
$$;

revoke all on function public.save_draft_colors_with_names(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_draft_colors_with_names(uuid, timestamptz, jsonb) to authenticated;

-- Existing full-sheet editors only send a single name. Keep the saved translations for retained UUIDs.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.save_product_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  v_anchor text := $anchor$specs = coalesce(p_payload->'specs', '{}'::jsonb),$anchor$;
  v_replacement text := $replacement$specs = (coalesce(p_payload->'specs', '{}'::jsonb) - 'colorNames') ||
        case when jsonb_typeof(v_existing.specs->'colorNames') = 'object' then jsonb_build_object('colorNames', (
          select coalesce(jsonb_object_agg(names.key, names.value), '{}'::jsonb)
          from jsonb_each(v_existing.specs->'colorNames') names
          where exists (
            select 1 from jsonb_array_elements(coalesce(p_colors, '[]'::jsonb)) retained
            where retained->>'id' = names.key
          )
        )) else '{}'::jsonb end,$replacement$;
begin
  if strpos(v_definition, 'v_existing public.product_drafts%rowtype') = 0
    or length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'Draft save definition changed; review color name preservation before applying.';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end
$migration$;
