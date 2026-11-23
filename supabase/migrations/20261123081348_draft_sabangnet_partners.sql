-- Reuse the outbound partner master. Saved labels remain available for old or removed partners.
create function app.draft_sabangnet_partner_name(p_brand_id uuid, p_target_id uuid)
returns text
language sql stable set search_path = '' as $$
  with recursive path as (
    select folder.id, folder.parent_id, folder.normalized_name, array[folder.id] as visited
    from public.code_usage_targets target
    join public.code_usage_target_folders folder
      on folder.brand_id = target.brand_id and folder.id = target.folder_id
    where target.id = p_target_id and target.brand_id = p_brand_id and target.active
    union all
    select parent.id, parent.parent_id, parent.normalized_name, path.visited || parent.id
    from path
    join public.code_usage_target_folders parent
      on parent.brand_id = p_brand_id and parent.id = path.parent_id
    where not parent.id = any(path.visited)
  )
  select name from public.code_usage_targets
  where id = p_target_id and brand_id = p_brand_id
    and exists (select 1 from path where parent_id is null and normalized_name = '온라인')
    and exists (select 1 from path where parent_id is not null and normalized_name = '사방넷')
$$;

create function app.guard_draft_open_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_id text := new.specs->>'openChannelTargetId';
  target_name text;
begin
  if tg_op = 'UPDATE' then
    if new.brand_id is not distinct from old.brand_id then
      if not (coalesce(new.specs, '{}'::jsonb) ? 'openChannelTargetId')
        and new.open_type_detail is not distinct from old.open_type_detail
        and old.specs->>'openChannelTargetId' is not null then
        new.specs := coalesce(new.specs, '{}'::jsonb)
          || jsonb_build_object('openChannelTargetId', old.specs->>'openChannelTargetId');
        return new;
      end if;
      if target_id is not null and target_id = old.specs->>'openChannelTargetId' then
        new.open_type_detail := old.open_type_detail;
        return new;
      end if;
    elsif target_id is not null and target_id = old.specs->>'openChannelTargetId' then
      new.specs := new.specs - 'openChannelTargetId';
      return new;
    end if;
  end if;
  if target_id is null then return new; end if;

  target_name := app.draft_sabangnet_partner_name(new.brand_id, target_id::uuid);
  if target_name is null then
    raise exception '해당 브랜드의 활성 사방넷 업체를 선택해 주세요.' using errcode = '22023';
  end if;
  new.open_type_detail := target_name;
  return new;
end
$$;

create trigger draft_open_channel_guard
before insert or update of brand_id, open_type_detail, specs on public.product_drafts
for each row execute function app.guard_draft_open_channel();

alter table public.draft_team_work
  drop constraint draft_team_work_section_check,
  add constraint draft_team_work_section_check
    check (section in ('amd', 'md-quantity', 'md-price', 'md-options', 'md-listing'));

-- Keep the existing permissions, parent lock, and revision checks in the team's save RPC.
do $migration$
declare
  definition text := replace(
    pg_get_functiondef('app.save_draft_team_work(uuid,text,jsonb,boolean,uuid)'::regprocedure), E'\r\n', E'\n'
  );
  fields_anchor text := $anchor$    when 'md-options' then array['type','entries']$anchor$;
  options_anchor text := $anchor$  else
    option_type := p_payload->'type';$anchor$;
begin
  if strpos(definition, fields_anchor) = 0 or strpos(definition, options_anchor) = 0 then
    raise exception 'Unexpected draft team save definition';
  end if;
  definition := replace(definition, fields_anchor, fields_anchor || $fields$
    when 'md-listing' then array['registerType','registerLabel','openType','openLabel','partnerId','partner','from','to','assignee']$fields$);
  definition := replace(definition, options_anchor, $listing$  elsif p_section = 'md-listing' then
    if jsonb_typeof(p_payload->'partnerId') not in ('string', 'null')
      or exists (
        select 1 from jsonb_each(p_payload - 'partnerId') field
        where jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 240
      )
      or (p_payload->>'from') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'
      or (p_payload->>'to') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then
      raise exception '진행업체와 발매 기간을 확인해 주세요.' using errcode = '22023';
    end if;
    if nullif(p_payload->>'to', '')::date < nullif(p_payload->>'from', '')::date then
      raise exception '발매 종료일을 확인해 주세요.' using errcode = '22023';
    end if;
    perform nullif(p_payload->>'from', '')::date, nullif(p_payload->>'to', '')::date;
$listing$ || options_anchor);
  execute definition;
end
$migration$;

create function app.guard_draft_md_partner()
returns trigger language plpgsql set search_path = '' as $$
declare
  target_id text := new.payload->>'partnerId';
  draft record;
  prior_partner text;
  target_name text;
begin
  if target_id is null then return new; end if;
  -- The RPC locks the parent draft before this upsert. BEFORE INSERT also runs for an upsert update.
  select brand_id, specs, open_type_detail into draft
  from public.product_drafts where id = new.draft_id;
  select payload->>'partner' into prior_partner
  from public.draft_team_work where draft_id = new.draft_id and section = 'md-listing'
    and payload->>'partnerId' = target_id;
  if prior_partner is not null then
    target_name := prior_partner;
  elsif target_id = draft.specs->>'openChannelTargetId' then
    target_name := coalesce(app.draft_sabangnet_partner_name(draft.brand_id, target_id::uuid), draft.open_type_detail);
  else
    target_name := app.draft_sabangnet_partner_name(draft.brand_id, target_id::uuid);
  end if;
  if target_name is null then
    raise exception '해당 브랜드의 활성 사방넷 업체를 선택해 주세요.' using errcode = '22023';
  end if;
  new.payload := jsonb_set(new.payload, '{partner}', to_jsonb(target_name));
  return new;
end
$$;

create trigger draft_md_partner_guard before insert on public.draft_team_work
for each row when (new.section = 'md-listing') execute function app.guard_draft_md_partner();

alter table public.draft_visual_content
  drop constraint draft_visual_content_check,
  add constraint draft_visual_content_check check (case kind
    when 'color-html' then jsonb_typeof(payload) = 'string' and octet_length(payload #>> '{}') <= 262144
    when 'color-photo' then jsonb_typeof(payload) = 'string'
      and length(payload #>> '{}') <= 98304
      and (payload #>> '{}') ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    when 'vendor-html' then jsonb_typeof(payload) = 'object'
      and payload ?& array['top', 'bottom']
      and jsonb_typeof(payload->'top') = 'string'
      and jsonb_typeof(payload->'bottom') = 'string'
      and octet_length(payload->>'top') <= 131072
      and octet_length(payload->>'bottom') <= 131072
      and (
        (entry_key in ('카카오선물하기', '자사몰', '무신사', '29CM', '지그재그', '오프라인')
          and (payload - array['top', 'bottom']) = '{}'::jsonb)
        or (entry_key ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          and payload ? 'vendorName' and jsonb_typeof(payload->'vendorName') = 'string'
          and length(payload->>'vendorName') > 0
          and (payload - array['top', 'bottom', 'vendorName']) = '{}'::jsonb)
      )
    when 'assignees' then entry_key = 'team' and jsonb_typeof(payload) = 'array'
    else false
  end);

create function app.guard_draft_html_partner()
returns trigger language plpgsql set search_path = '' as $$
declare
  target_name text;
begin
  -- Legacy entries keep the original shape and are still accepted during rollout.
  if new.entry_key !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or jsonb_typeof(new.payload) is distinct from 'object' then
    return new;
  end if;
  select payload->>'vendorName' into target_name
  from public.draft_visual_content
  where draft_id = new.draft_id and kind = new.kind and entry_key = new.entry_key;
  if target_name is null then
    select app.draft_sabangnet_partner_name(brand_id, new.entry_key::uuid) into target_name
    from public.product_drafts where id = new.draft_id;
  end if;
  if target_name is null then
    raise exception '해당 브랜드의 활성 사방넷 업체를 선택해 주세요.' using errcode = '22023';
  end if;
  new.payload := jsonb_set(new.payload, '{vendorName}', to_jsonb(target_name));
  return new;
end
$$;

create trigger draft_html_partner_guard before insert on public.draft_visual_content
for each row when (new.kind = 'vendor-html') execute function app.guard_draft_html_partner();

revoke all on function app.draft_sabangnet_partner_name(uuid, uuid), app.guard_draft_open_channel(),
  app.guard_draft_md_partner(), app.guard_draft_html_partner() from public, anon, authenticated;
