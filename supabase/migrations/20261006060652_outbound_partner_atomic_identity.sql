-- 기존 ID·이름·이력은 그대로 두고, 새 이름 충돌과 부분 저장만 막는다.
create or replace function app.outbound_partner_name_key(p_value text)
returns text language sql immutable strict set search_path = ''
as $$
  select regexp_replace(lower(normalize(p_value, NFKC)), '[^0-9a-z가-힣]', '', 'g');
$$;

create or replace function app.outbound_partner_name_keys(
  p_name text, p_normalized_name text, p_group_name text, p_site_name text
) returns text[] language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct key), array[]::text[])
    from unnest(array[
      app.outbound_partner_name_key(
        case when btrim(coalesce(p_group_name, '')) <> ''
          then p_group_name || ' ' || coalesce(p_site_name, '')
          else coalesce(nullif(regexp_replace(btrim(p_name), ' (온라인|오프라인)$', ''), ''), p_name)
        end
      ),
      app.outbound_partner_name_key(p_name),
      app.outbound_partner_name_key(p_normalized_name)
    ]) keys(key)
   where key <> '';
$$;

-- 브랜드별 이름 쓰기를 직렬화하고 비교 키는 원문에서 계산한다.
create or replace function app.lock_outbound_partner_names()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended('outbound-partner:' || old.brand_id::text, 0));
    return old;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outbound-partner:' || new.brand_id::text, 0));
  if tg_table_name = 'code_usage_target_aliases' then
    new.normalized_alias := app.outbound_partner_name_key(new.alias);
  else
    new.normalized_name := app.outbound_partner_name_key(new.name);
    if tg_table_name = 'code_usage_targets' then
      new.normalized_site_name := app.outbound_partner_name_key(new.site_name);
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.assert_outbound_partner_name_keys(
  p_brand_id uuid, p_target_id uuid, p_keys text[], p_previous_keys text[]
) returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_key text;
  v_other_name text;
begin
  foreach v_key in array p_keys loop
    -- 이전 중복을 소급해서 지우거나 연락처 수정까지 차단하지 않는다.
    if v_key = any(p_previous_keys) then continue; end if;
    select coalesce(nullif(g.name, ''), t.name) ||
           case when t.site_name <> '' then ' · ' || t.site_name else '' end
      into v_other_name
      from public.code_usage_targets t
      left join public.outbound_partner_groups g
        on g.id = t.group_id and g.brand_id = t.brand_id
     where t.brand_id = p_brand_id and t.id <> p_target_id
       and v_key = any(app.outbound_partner_name_keys(t.name, t.normalized_name, g.name, t.site_name))
     limit 1;
    if v_other_name is null then
      select a.alias into v_other_name
        from public.code_usage_target_aliases a
       where a.brand_id = p_brand_id and a.target_id <> p_target_id
         and a.normalized_alias = v_key limit 1;
    end if;
    if v_other_name is not null then
      raise exception '이름이 다른 출고업체의 이름 또는 별칭 "%"와 겹칩니다.', v_other_name
        using errcode = '23505', constraint = 'outbound_partner_name_conflict';
    end if;
  end loop;
end;
$$;

-- RPC의 중간 상태가 아니라 업체·지점·별칭을 모두 변경한 최종 상태를 검사한다.
create or replace function app.check_outbound_partner_target_names()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_target public.code_usage_targets%rowtype;
  v_group_name text;
  v_previous_group_name text;
  v_previous_keys text[] := array[]::text[];
begin
  select * into v_target from public.code_usage_targets where id = new.id;
  if not found then return null; end if;
  select name into v_group_name from public.outbound_partner_groups
    where id = v_target.group_id and brand_id = v_target.brand_id;
  if tg_op = 'UPDATE' and old.brand_id = v_target.brand_id then
    select name into v_previous_group_name from public.outbound_partner_groups
      where id = old.group_id and brand_id = old.brand_id;
    v_previous_keys := app.outbound_partner_name_keys(
      old.name, old.normalized_name, v_previous_group_name, old.site_name
    );
  end if;
  perform app.assert_outbound_partner_name_keys(
    v_target.brand_id, v_target.id,
    app.outbound_partner_name_keys(v_target.name, v_target.normalized_name, v_group_name, v_target.site_name),
    v_previous_keys
  );
  return null;
end;
$$;

create or replace function app.check_outbound_partner_group_names()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_group public.outbound_partner_groups%rowtype;
  v_target public.code_usage_targets%rowtype;
begin
  select * into v_group from public.outbound_partner_groups where id = new.id;
  if not found or app.outbound_partner_name_key(v_group.name) = app.outbound_partner_name_key(old.name) then
    return null;
  end if;
  for v_target in select * from public.code_usage_targets
    where group_id = v_group.id and brand_id = v_group.brand_id
  loop
    perform app.assert_outbound_partner_name_keys(
      v_target.brand_id, v_target.id,
      app.outbound_partner_name_keys(v_target.name, v_target.normalized_name, v_group.name, v_target.site_name),
      app.outbound_partner_name_keys(v_target.name, v_target.normalized_name, old.name, v_target.site_name)
    );
  end loop;
  return null;
end;
$$;

create or replace function app.check_outbound_partner_alias_names()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_alias public.code_usage_target_aliases%rowtype;
begin
  select * into v_alias from public.code_usage_target_aliases where id = new.id;
  if not found then return null; end if;
  perform app.assert_outbound_partner_name_keys(
    v_alias.brand_id, v_alias.target_id, array[v_alias.normalized_alias], array[]::text[]
  );
  return null;
end;
$$;

create trigger outbound_partner_groups_name_lock
before insert or update or delete on public.outbound_partner_groups
for each row execute function app.lock_outbound_partner_names();

create trigger code_usage_targets_name_lock
before insert or update or delete on public.code_usage_targets
for each row execute function app.lock_outbound_partner_names();

create trigger code_usage_target_aliases_name_lock
before insert or update or delete on public.code_usage_target_aliases
for each row execute function app.lock_outbound_partner_names();

create constraint trigger outbound_partner_groups_name_guard
after update on public.outbound_partner_groups
deferrable initially deferred for each row
execute function app.check_outbound_partner_group_names();

create constraint trigger code_usage_targets_name_guard
after insert or update on public.code_usage_targets
deferrable initially deferred for each row
execute function app.check_outbound_partner_target_names();

create constraint trigger code_usage_target_aliases_name_guard
after insert or update on public.code_usage_target_aliases
deferrable initially deferred for each row
execute function app.check_outbound_partner_alias_names();

create or replace function public.save_outbound_partner_unit_atomic(
  p_brand_id uuid, p_id uuid, p_name text, p_normalized_name text,
  p_channel_type text, p_shipping_method text, p_is_one_time boolean,
  p_active boolean, p_note text, p_folder_id uuid, p_group_id uuid,
  p_group_name text, p_site_name text, p_normalized_site_name text,
  p_contact_name text, p_contact_phone text, p_contact_email text,
  p_address text, p_aliases jsonb
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_group_id uuid := p_group_id;
  v_group_name text := btrim(regexp_replace(coalesce(p_group_name, ''), '\s+', ' ', 'g'));
  v_group_key text := app.outbound_partner_name_key(v_group_name);
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outbound-partner:' || p_brand_id::text, 0));
  if p_group_name is not null then
    if v_group_key = '' then raise exception '업체 이름에 글자나 숫자가 있어야 합니다.'; end if;
    if v_group_id is null then
      select id into v_group_id from public.outbound_partner_groups
        where brand_id = p_brand_id and normalized_name = v_group_key;
      if v_group_id is null then
        insert into public.outbound_partner_groups(brand_id, name, normalized_name, sort_order)
        select p_brand_id, v_group_name, v_group_key, coalesce(max(sort_order) + 1, 0)
          from public.outbound_partner_groups where brand_id = p_brand_id
        returning id into v_group_id;
      end if;
    else
      update public.outbound_partner_groups set name = v_group_name, normalized_name = v_group_key
        where id = v_group_id and brand_id = p_brand_id;
      if not found then raise exception '업체 그룹을 찾을 수 없습니다.'; end if;
    end if;
  end if;
  return public.save_outbound_partner_unit_with_aliases(
    p_brand_id, p_id, p_name, p_normalized_name, p_channel_type,
    p_shipping_method, p_is_one_time, p_active, p_note, p_folder_id,
    v_group_id, p_site_name, p_normalized_site_name, p_contact_name,
    p_contact_phone, p_contact_email, p_address, p_aliases
  );
end;
$$;

revoke all on function public.save_outbound_partner_unit_atomic(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.save_outbound_partner_unit_atomic(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, text, text, text, text, text, jsonb
) to authenticated;

revoke all on function app.outbound_partner_name_key(text),
  app.outbound_partner_name_keys(text, text, text, text),
  app.lock_outbound_partner_names(),
  app.assert_outbound_partner_name_keys(uuid, uuid, text[], text[]),
  app.check_outbound_partner_target_names(), app.check_outbound_partner_group_names(),
  app.check_outbound_partner_alias_names() from public, anon;
grant execute on function app.outbound_partner_name_key(text),
  app.outbound_partner_name_keys(text, text, text, text),
  app.lock_outbound_partner_names(),
  app.assert_outbound_partner_name_keys(uuid, uuid, text[], text[]),
  app.check_outbound_partner_target_names(), app.check_outbound_partner_group_names(),
  app.check_outbound_partner_alias_names() to authenticated;

notify pgrst, 'reload schema';
