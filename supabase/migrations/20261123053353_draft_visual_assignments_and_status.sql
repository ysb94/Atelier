alter table public.draft_information_temporary
  drop constraint draft_information_temporary_field_check,
  add constraint draft_information_temporary_field_check check (field in ('size', 'fabric', 'specDoc', 'html', 'image')),
  add constraint draft_information_temporary_image_check check (field <> 'image' or (
    jsonb_typeof(edits->'image'->'source') = 'string' and length(edits->'image'->>'source') <= 36
    and jsonb_typeof(edits->'image'->'text') = 'string' and length(edits->'image'->>'text') <= 98304
    and (edits->'image'->>'text') ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  ) is true);

alter table public.draft_visual_content
  drop constraint draft_visual_content_kind_check,
  drop constraint draft_visual_content_check,
  add constraint draft_visual_content_kind_check check (kind in ('color-html', 'color-photo', 'vendor-html', 'assignees')),
  add constraint draft_visual_content_check check (case kind
    when 'color-html' then jsonb_typeof(payload) = 'string' and octet_length(payload #>> '{}') <= 262144
    when 'color-photo' then jsonb_typeof(payload) = 'string'
      and length(payload #>> '{}') <= 98304
      and (payload #>> '{}') ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    when 'vendor-html' then entry_key in ('카카오선물하기', '자사몰', '무신사', '29CM', '지그재그', '오프라인')
      and jsonb_typeof(payload) = 'object'
      and payload ?& array['top', 'bottom']
      and (payload - array['top', 'bottom']) = '{}'::jsonb
      and jsonb_typeof(payload->'top') = 'string'
      and jsonb_typeof(payload->'bottom') = 'string'
      and octet_length(payload->>'top') <= 131072
      and octet_length(payload->>'bottom') <= 131072
    when 'assignees' then entry_key = 'team' and jsonb_typeof(payload) = 'array'
    else false
  end);

alter policy draft_visual_content_read on public.draft_visual_content using (
  exists (select 1 from public.product_drafts d where d.id = draft_id)
  and (kind in ('vendor-html', 'assignees') or exists (
    select 1 from public.draft_colors c
    where c.draft_id = draft_visual_content.draft_id
      and c.id = case when kind in ('color-html', 'color-photo') then entry_key::uuid end
  ))
);

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
  select company_id into draft_company from public.product_drafts where id = p_draft_id for no key update;
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
    where draft_id = p_draft_id and kind = change_kind and entry_key = change_key;
    if current_revision is distinct from (change->>'revision')::uuid then
      raise exception '다른 화면에서 먼저 저장했습니다.' using errcode = '40001';
    end if;
    return query
      insert into public.draft_visual_content(draft_id, kind, entry_key, payload)
      values (p_draft_id, change_kind, change_key, change->'payload')
      on conflict (draft_id, kind, entry_key) do update
        set payload = excluded.payload, revision = gen_random_uuid()
      returning draft_visual_content.*;
    if change_kind in ('color-html', 'color-photo') and p_temporary_revision is not null then
      delete from public.draft_information_temporary
      where draft_id = p_draft_id and color_id = change_key::uuid
        and field = case when change_kind = 'color-photo' then 'image' else 'html' end
        and editor_id = auth.uid() and revision = p_temporary_revision;
    end if;
  end loop;
end
$$;

-- Keep full HTML and image payloads out of the board response.
create function public.list_draft_visual_status(p_draft_ids uuid[])
returns table (draft_id uuid, saved_images text[], saved_html text[], temporary_images uuid[], temporary_html uuid[],
  assignee_ids jsonb, assignee_revision uuid)
language sql stable security invoker set search_path = '' as $$
  select d.id,
    coalesce(saved.images, '{}'::text[]), coalesce(saved.html, '{}'::text[]),
    coalesce(temp.images, '{}'::uuid[]), coalesce(temp.html, '{}'::uuid[]),
    coalesce(team.payload, '[]'::jsonb), team.revision
  from public.product_drafts d
  left join public.draft_visual_content team on team.draft_id = d.id and team.kind = 'assignees' and team.entry_key = 'team'
  left join lateral (
    select array_agg(v.entry_key) filter (where v.kind = 'color-photo') images,
      array_agg(v.entry_key) filter (where v.kind = 'color-html' and v.payload #>> '{}' ~ '[^[:space:]]') html
    from public.draft_visual_content v where v.draft_id = d.id and v.kind in ('color-photo', 'color-html')
  ) saved on true
  left join lateral (
    select array_agg(t.color_id) filter (where t.field = 'image') images,
      array_agg(t.color_id) filter (where t.field = 'html') html
    from public.draft_information_temporary t
    join public.draft_colors c on c.id = t.color_id and c.draft_id = d.id
    where t.draft_id = d.id and t.editor_id = (select auth.uid()) and t.field in ('image', 'html')
  ) temp on true
  where d.id = any(p_draft_ids) and cardinality(p_draft_ids) <= 80
$$;

revoke all on function public.list_draft_visual_status(uuid[]) from public, anon, authenticated;
grant execute on function public.list_draft_visual_status(uuid[]) to authenticated;
