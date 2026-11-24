create table public.draft_information_notices (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  draft_no text not null,
  draft_name text not null,
  field text not null check (field in ('size', 'fabric', 'specDoc')),
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) > 0),
  saved_values jsonb not null check (jsonb_typeof(saved_values) = 'array' and jsonb_array_length(saved_values) = jsonb_array_length(changes)),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);

create index draft_information_notices_inbox on public.draft_information_notices (recipient_id, created_at desc);
create index draft_information_notices_draft on public.draft_information_notices (draft_id);
alter table public.draft_information_notices enable row level security;
revoke all on public.draft_information_notices from public, anon, authenticated;
grant select on public.draft_information_notices to authenticated;

create policy draft_information_notices_recipient on public.draft_information_notices
  for select to authenticated using (
    recipient_id = (select auth.uid())
    and exists (
      select 1 from public.product_drafts d
      join public.profiles p on p.id = (select auth.uid()) and p.company_id = d.company_id and p.status = 'active'
      where d.id = draft_id
    )
  );

-- Resolve old shared specs and explicit color overrides just as the INFORMATION form does.
create function app.draft_information_notice_values(specs jsonb, color uuid, field_name text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  color_spec jsonb := specs->'colorSpecs'->color::text;
  has_color boolean := coalesce(jsonb_typeof(color_spec) = 'object', false);
  primary_value text;
  secondary_value text;
  primary_confirmed boolean;
  secondary_confirmed boolean;
  confirmation jsonb;
  field_values jsonb;
  confirmed boolean;
begin
  if color is null then
    has_color := false;
  end if;
  if field_name = 'specDoc' then
    field_values := jsonb_build_object('specDoc', btrim(coalesce(specs->'coating'->>'note', '')));
    confirmation := specs->'specDocumentConfirmed';
    confirmed := coalesce(specs->'size'->'confirmed' = 'true'::jsonb, false)
      and coalesce(specs->'fabric'->'confirmed' = 'true'::jsonb, false)
      and coalesce(specs->'weight'->'confirmed' = 'true'::jsonb, false);
  elsif field_name = 'size' then
    primary_value := btrim(coalesce(case when has_color then color_spec->>'size' else specs->'size'->>'value' end, ''));
    secondary_value := btrim(coalesce(case when has_color then color_spec->>'weight' else specs->'weight'->>'value' end, ''));
    primary_confirmed := coalesce(specs->'size'->'confirmed' = 'true'::jsonb, false);
    secondary_confirmed := coalesce(specs->'weight'->'confirmed' = 'true'::jsonb, false);
    confirmation := color_spec->'sizeConfirmed';
    field_values := jsonb_build_object('size', primary_value, 'weight', secondary_value, 'sizeNote', btrim(coalesce(color_spec->>'sizeNote', '')));
  else
    primary_value := btrim(coalesce(case when has_color then color_spec->>'fabric' else specs->'fabric'->>'value' end, ''));
    secondary_value := btrim(coalesce(color_spec->>'coating', specs->'coating'->>'value', ''));
    primary_confirmed := coalesce(specs->'fabric'->'confirmed' = 'true'::jsonb, false);
    secondary_confirmed := coalesce(specs->'coating'->'confirmed' = 'true'::jsonb, false);
    confirmation := color_spec->'fabricConfirmed';
    field_values := jsonb_build_object('fabric', primary_value, 'coating', secondary_value);
  end if;

  if field_name <> 'specDoc' then
    confirmed := (primary_value = '' or primary_confirmed) and (secondary_value = '' or secondary_confirmed)
      and (primary_value <> '' or secondary_value <> '');
  end if;
  if jsonb_typeof(confirmation) = 'boolean' then
    confirmed := confirmation = 'true'::jsonb;
  end if;
  return jsonb_build_object('confirmed', confirmed, 'values', field_values);
end;
$$;

create function app.notify_draft_information_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  recipients uuid[];
  field_name text;
  changes jsonb;
begin
  if auth.uid() is null then return new; end if;

  -- Existing Visual assignment writes lock the same product_drafts row.
  select array_agg(distinct p.id) into recipients
  from public.draft_visual_content team
  cross join lateral jsonb_array_elements_text(team.payload) as assignee(id)
  join public.profiles p on p.id::text = assignee.id
  where team.draft_id = new.id and team.kind = 'assignees' and team.entry_key = 'team'
    and p.company_id = new.company_id and p.status = 'active' and p.department_id = app.work_department('design');
  if recipients is null then return new; end if;

  foreach field_name in array array['size', 'fabric', 'specDoc'] loop
    select jsonb_agg(jsonb_build_object(
      'color', color.name,
      'status', case
        when before_edit.item->'confirmed' = 'true'::jsonb and after_edit.item->'confirmed' = 'false'::jsonb then 'reopened'
        when before_edit.item->'confirmed' = 'false'::jsonb and after_edit.item->'confirmed' = 'true'::jsonb then 'confirmed'
        else 'changed'
      end,
      'values', after_edit.item->'values',
      'fields', array(
        select key from jsonb_object_keys(after_edit.item->'values') as field(key)
        where (before_edit.item->'values'->key) is distinct from (after_edit.item->'values'->key)
        order by key
      )
    ) order by color.sort_order, color.id) into changes
    from (
      select c.id, coalesce(nullif(btrim(c.name), ''), '컬러 미정') as name, c.sort_order
      from public.draft_colors c where c.draft_id = new.id and field_name <> 'specDoc'
      union all
      select null::uuid, null::text, 0 where field_name = 'specDoc'
        or not exists (select 1 from public.draft_colors c where c.draft_id = new.id)
    ) color
    cross join lateral (select app.draft_information_notice_values(old.specs, color.id, field_name) as item) before_edit
    cross join lateral (select app.draft_information_notice_values(new.specs, color.id, field_name) as item) after_edit
    where before_edit.item is distinct from after_edit.item;

    if changes is not null then
      insert into public.draft_information_notices (draft_id, recipient_id, draft_no, draft_name, field, changes, saved_values)
      select new.id, recipient, new.draft_no, coalesce(nullif(btrim(new.name_ko), ''), nullif(btrim(new.name_en), ''), ''),
        field_name, details.changes, details.saved_values
      from (
        select jsonb_agg(item - 'values' order by position) as changes,
          jsonb_agg(item->'values' order by position) as saved_values
        from jsonb_array_elements(changes) with ordinality as event(item, position)
      ) details
      cross join unnest(recipients) as users(recipient);
    end if;
  end loop;
  return new;
end;
$$;

create trigger notify_draft_information_change
after update of specs on public.product_drafts for each row
when (old.specs is distinct from new.specs)
execute function app.notify_draft_information_change();

create function app.read_draft_information_notice(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  seen_at timestamptz;
begin
  select n.read_at into seen_at
  from public.draft_information_notices n
  join public.product_drafts d on d.id = n.draft_id
  join public.profiles p on p.id = n.recipient_id and p.company_id = d.company_id and p.status = 'active'
  where n.id = p_id and n.recipient_id = (select auth.uid()) and app.can_read_company(d.company_id)
  for update of n;
  if not found or seen_at is not null then return seen_at; end if;
  update public.draft_information_notices set read_at = clock_timestamp() where id = p_id returning read_at into seen_at;
  return seen_at;
end;
$$;

create function public.read_draft_information_notice(p_id uuid)
returns timestamptz language sql security invoker set search_path = '' as $$
  select app.read_draft_information_notice(p_id);
$$;

revoke all on function app.draft_information_notice_values(jsonb, uuid, text),
  app.notify_draft_information_change(), app.read_draft_information_notice(uuid),
  public.read_draft_information_notice(uuid) from public, anon, authenticated;
grant execute on function app.read_draft_information_notice(uuid),
  public.read_draft_information_notice(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.draft_information_notices;
  end if;
end
$$;
