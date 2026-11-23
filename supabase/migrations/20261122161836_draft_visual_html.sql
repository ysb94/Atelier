create table public.draft_visual_content (
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  kind text not null,
  entry_key text not null,
  revision uuid not null default gen_random_uuid(),
  payload jsonb not null,
  primary key (draft_id, kind, entry_key),
  check (kind in ('color-html', 'color-photo', 'vendor-html')),
  check (case kind
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
    else false
  end)
);

alter table public.draft_visual_content enable row level security;
revoke all on public.draft_visual_content from public, anon, authenticated;
grant select on public.draft_visual_content to authenticated;

-- Use the existing draft and color RLS. Color IDs survive the legacy
-- full-draft delete/reinsert, so a cascading color FK would lose saved content.
create policy draft_visual_content_read on public.draft_visual_content
  for select to authenticated using (
    exists (select 1 from public.product_drafts d where d.id = draft_id)
    and (kind = 'vendor-html' or exists (
      select 1 from public.draft_colors c
      where c.draft_id = draft_visual_content.draft_id
        and c.id = case when kind in ('color-html', 'color-photo') then entry_key::uuid end
    ))
  );

alter table public.draft_information_temporary
  drop constraint draft_information_temporary_field_check,
  add constraint draft_information_temporary_field_check check (field in ('size', 'fabric', 'specDoc', 'html')),
  add constraint draft_information_temporary_html_check check (field <> 'html' or (
    edits ? 'html' and jsonb_typeof(edits->'html'->'source') = 'string'
    and jsonb_typeof(edits->'html'->'text') = 'string'
    and octet_length(edits->'html'->>'text') <= 262144
    and length(edits->'html'->>'source') <= 36
  ) is true);

create function app.save_draft_visual_content(
  p_draft_id uuid, p_changes jsonb, p_temporary_revision uuid
) returns setof public.draft_visual_content
language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  current_revision uuid;
  change_kind text;
  change_key text;
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
  perform 1 from public.product_drafts where id = p_draft_id for no key update;
  if not found or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    change_kind := change->>'kind';
    change_key := change->>'entry_key';
    if change_kind in ('color-html', 'color-photo') then
      if change_key is null or not exists (
        select 1 from public.draft_colors
        where draft_id = p_draft_id and id = change_key::uuid
      ) then
        raise exception '이 기획안에 등록된 컬러가 아닙니다.' using errcode = '22023';
      end if;
      change_key := (change_key::uuid)::text;
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
    if change_kind = 'color-html' and p_temporary_revision is not null then
      delete from public.draft_information_temporary
      where draft_id = p_draft_id and field = 'html' and color_id = change_key::uuid
        and editor_id = auth.uid() and revision = p_temporary_revision;
    end if;
  end loop;
end
$$;

create function public.save_draft_visual_content(
  p_draft_id uuid, p_changes jsonb, p_temporary_revision uuid default null
) returns setof public.draft_visual_content
language sql security invoker set search_path = '' as $$
  select * from app.save_draft_visual_content(p_draft_id, p_changes, p_temporary_revision)
$$;

revoke all on function app.save_draft_visual_content(uuid, jsonb, uuid),
  public.save_draft_visual_content(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function app.save_draft_visual_content(uuid, jsonb, uuid),
  public.save_draft_visual_content(uuid, jsonb, uuid) to authenticated;

create function app.preserve_draft_release_schedule()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Older draft editors submit the full specs object without the schedule key.
  if old.season_id = new.season_id and not (coalesce(new.specs, '{}'::jsonb) ? 'releaseSchedule')
    and old.specs->'releaseSchedule'->>'seasonId' = new.season_id::text then
    new.specs := jsonb_set(coalesce(new.specs, '{}'::jsonb), '{releaseSchedule}', old.specs->'releaseSchedule');
  elsif new.specs ? 'releaseSchedule' and (
    new.season_id is null or new.specs->'releaseSchedule'->>'seasonId' is distinct from new.season_id::text
  ) then
    new.specs := new.specs - 'releaseSchedule';
  end if;
  return new;
end
$$;

revoke all on function app.preserve_draft_release_schedule() from public, anon, authenticated;
create trigger draft_release_schedule_preserve
  before update of season_id, specs on public.product_drafts
  for each row execute function app.preserve_draft_release_schedule();
