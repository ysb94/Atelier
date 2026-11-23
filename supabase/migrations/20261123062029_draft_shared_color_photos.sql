-- COLOR edits retire the final version while retaining its saved image bytes.
alter table public.draft_visual_content add column photo_current boolean not null default true;

alter policy draft_visual_content_read on public.draft_visual_content using (
  exists (select 1 from public.product_drafts d where d.id = draft_id)
  and (kind <> 'color-photo' or photo_current)
  and (kind in ('vendor-html', 'assignees') or exists (
    select 1 from public.draft_colors c
    where c.draft_id = draft_visual_content.draft_id
      and c.id = case when kind in ('color-html', 'color-photo') then entry_key::uuid end
  ))
);

create function app.expire_draft_visual_photos(p_draft_id uuid, p_color_keys text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  -- This helper is called by the existing invoker COLOR save while it holds the draft lock.
  -- Take the same lock for a direct internal call.
  perform 1 from public.product_drafts where id = p_draft_id for no key update;
  if not found or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  update public.draft_visual_content set photo_current = false
  where draft_id = p_draft_id and kind = 'color-photo' and photo_current and entry_key = any(p_color_keys);
end
$$;

revoke all on function app.expire_draft_visual_photos(uuid, text[]) from public, anon, authenticated;
grant execute on function app.expire_draft_visual_photos(uuid, text[]) to authenticated;

create or replace function public.save_draft_colors(p_draft_id uuid, p_expected_updated_at timestamptz, p_colors jsonb)
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
    perform app.expire_draft_visual_photos(p_draft_id, v_removed || array(
      select ((item->>'id')::uuid)::text from jsonb_array_elements(p_colors) as item where item ? 'imageChoice'
    ));
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

create or replace function app.save_draft_visual_content(
  p_draft_id uuid, p_changes jsonb, p_temporary_revision uuid
) returns setof public.draft_visual_content
language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  current_revision uuid;
  change_kind text;
  change_key text;
  draft_company uuid;
  draft_updated_at timestamptz;
  assignees uuid[];
begin
  if auth.uid() is null or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception '저장할 항목을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 9 then
    raise exception '저장할 항목 수를 확인해 주세요.' using errcode = '22023';
  end if;

  -- Serialize with the existing draft/color save paths and recheck after waiting.
  select company_id, updated_at into draft_company, draft_updated_at
  from public.product_drafts where id = p_draft_id for no key update;
  if not found or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    change_kind := change->>'kind';
    change_key := change->>'entry_key';
    if change_kind in ('color-html', 'color-photo') then
      if change_key is null or not exists (
        select 1 from public.draft_colors where draft_id = p_draft_id and id = change_key::uuid
      ) then
        raise exception '이 기획안에 등록된 컬러가 아닙니다.' using errcode = '22023';
      end if;
      change_key := (change_key::uuid)::text;
    elsif change_kind = 'assignees' then
      if change_key is distinct from 'team' or jsonb_typeof(change->'payload') is distinct from 'array' then
        raise exception '비주얼 담당자를 확인해 주세요.' using errcode = '22023';
      end if;
      if jsonb_array_length(change->'payload') > 100 then
        raise exception '담당자 수를 확인해 주세요.' using errcode = '22023';
      end if;
      select coalesce(array_agg(value::uuid), '{}'::uuid[]) into assignees from jsonb_array_elements_text(change->'payload');
      if cardinality(assignees) <> (select count(distinct c.assignee_id) from unnest(assignees) as c(assignee_id))
        or exists (select 1 from unnest(assignees) as c(assignee_id)
          where not exists (select 1 from public.profiles p where p.id = c.assignee_id and p.company_id = draft_company
            and p.status = 'active' and p.department_id = app.work_department('design')))
      then
        raise exception '같은 회사의 재직 중인 Visual 팀 직원을 선택해 주세요.' using errcode = '22023';
      end if;
      change := jsonb_set(change, '{payload}', to_jsonb(assignees));
    end if;
    select revision into current_revision from public.draft_visual_content
    where draft_id = p_draft_id and kind = change_kind and entry_key = change_key
      and (kind <> 'color-photo' or photo_current);
    if current_revision is distinct from (change->>'revision')::uuid
      or (change_kind = 'color-photo' and change ? 'draft_revision'
        and draft_updated_at is distinct from (change->>'draft_revision')::timestamptz)
    then
      raise exception '다른 화면에서 먼저 저장했습니다.' using errcode = '40001';
    end if;
    return query
      insert into public.draft_visual_content(draft_id, kind, entry_key, payload)
      values (p_draft_id, change_kind, change_key, change->'payload')
      on conflict (draft_id, kind, entry_key) do update
        set payload = excluded.payload, revision = gen_random_uuid(), photo_current = true
      returning draft_visual_content.*;
    if change_kind = 'color-photo' then
      update public.product_drafts
      set specs = coalesce(specs, '{}'::jsonb) || jsonb_build_object(
        'colorImageChoices', (case when jsonb_typeof(specs->'colorImageChoices') = 'object'
          then specs->'colorImageChoices' else '{}'::jsonb end) || jsonb_build_object(change_key, 'Image'::text),
        'colorPhotoUrls', (case when jsonb_typeof(specs->'colorPhotoUrls') = 'object'
          then specs->'colorPhotoUrls' else '{}'::jsonb end) || jsonb_build_object(change_key, change->'payload')
      ), updated_at = statement_timestamp()
      where id = p_draft_id;
    end if;
    if change_kind in ('color-html', 'color-photo') and p_temporary_revision is not null then
      delete from public.draft_information_temporary
      where draft_id = p_draft_id and color_id = change_key::uuid
        and field = case when change_kind = 'color-photo' then 'image' else 'html' end
        and editor_id = auth.uid() and revision = p_temporary_revision;
    end if;
  end loop;
end
$$;
