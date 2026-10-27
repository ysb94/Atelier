-- Basic work access is independent from administrative, approval and delete rights.
create or replace function app.work_department(p_domain text) returns uuid language sql immutable set search_path='' as $$
 select case p_domain when 'planning' then 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'::uuid when 'design' then '7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1'::uuid when 'md' then '919b2c44-afb6-4d7e-a5b8-b7203df9cef9'::uuid when 'logistics' then 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'::uuid when 'china' then 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'::uuid when 'operations' then '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'::uuid end
$$;
create or replace function app.work_operator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001' and p.id in ('d0000000-0000-4000-8000-000000000001','a5afdd00-4a61-44dc-a1a3-082fa8a1345d','56074867-fdc2-4ce5-8e97-cea431decc36'))
$$;
create or replace function app.basic_work_allowed(p_domain text,p_brand uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001'
 and (p_brand is null or exists(select 1 from public.brands b where b.id=p_brand and b.company_id=p.company_id))
 and (app.work_operator() or p.is_admin or (p.department_id=app.work_department(p_domain) and exists(select 1 from public.departments d where d.id=p.department_id and d.company_id=p.company_id and d.is_active))
 or exists(select 1 from public.profile_capabilities c where c.profile_id=p.id and c.capability=p_domain)
 or app.permission_allowed('data.'||p_domain,'brand',p_brand)))
$$;
create or replace function app.work_manage_allowed(p_domain text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001'
 and (app.permission_allowed('work.manage','department',app.work_department(p_domain))
 or (p.department_id=app.work_department(p_domain) and (p.is_admin or p.position in ('팀장','이사')))))
$$;
create or replace function public.get_my_basic_work_access() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('profileId',auth.uid(),'operator',app.work_operator(),'legacyEdit',app.can_edit_brand(null),
 'domains',coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics','china','operations']) d where app.basic_work_allowed(d)),'[]'),
 'brandDomains',coalesce((select jsonb_object_agg(b.id,coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics']) d where app.basic_work_allowed(d,b.id)),'[]')) from public.brands b where b.company_id='e0000000-0000-4000-8000-000000000001' and app.can_read_brand(b.id)),'{}'),
 'manageOwners',coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics']) d where app.work_manage_allowed(d)),'[]'))
$$;
revoke all on function public.get_my_basic_work_access() from public,anon;
grant execute on function public.get_my_basic_work_access() to authenticated;

alter table public.product_drafts add column created_by uuid references public.profiles(id);
comment on column public.product_drafts.created_by is 'Immutable actual creator. NULL means legacy creator is unknown; never infer from editable owner label.';
create index product_drafts_creator_idx on public.product_drafts(company_id,created_by);
create or replace function app.draft_write_allowed(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_drafts d join public.profiles p on p.id=auth.uid() and p.status='active' and p.company_id=d.company_id where d.id=p_id and (app.work_operator() or d.created_by=p.id))
$$;
create or replace function app.guard_draft_owner() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if not app.basic_work_allowed('planning',new.brand_id) or new.company_id<>'e0000000-0000-4000-8000-000000000001' then raise exception '기획안 생성 권한이 없습니다.' using errcode='42501'; end if;
  new.created_by:=auth.uid(); return new;
 end if;
 if tg_op='UPDATE' and new.created_by is distinct from old.created_by then raise exception '기획안 작성자는 변경할 수 없습니다.' using errcode='42501'; end if;
 if not app.draft_write_allowed(old.id) then
  if not (tg_op='UPDATE' and current_user in ('postgres','supabase_admin') and current_setting('app.china_workorder',true)='on' and app.basic_work_allowed('china')
    and (to_jsonb(new)-array['sample_work_orders','specs','updated_at'])=(to_jsonb(old)-array['sample_work_orders','specs','updated_at'])) then
   raise exception '기획안은 작성자만 수정·삭제할 수 있습니다.' using errcode='42501';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.company_id is distinct from old.company_id then raise exception '기획안 회사는 변경할 수 없습니다.'; end if;
 if new.id<>old.id or new.draft_no is distinct from old.draft_no or new.created_at is distinct from old.created_at then raise exception '기획안 식별 정보는 변경할 수 없습니다.'; end if;
 if not app.draft_brand_in_company(new.company_id,new.brand_id) then raise exception '다른 회사 브랜드에는 배정할 수 없습니다.'; end if;
 if old.status='confirmed' and new.brand_id is distinct from old.brand_id then raise exception '출시 확정된 기획안은 브랜드를 바꿀 수 없습니다.'; end if;
 return new;
end $$;
create trigger draft_owner_guard before insert or update or delete on public.product_drafts for each row execute function app.guard_draft_owner();
create or replace function app.guard_draft_child_owner() returns trigger language plpgsql set search_path='' as $$
declare parent_id uuid;
begin
 parent_id:=case when tg_op='DELETE' then old.draft_id else new.draft_id end;
 if not app.draft_write_allowed(parent_id) and not (tg_op='UPDATE' and current_user in ('postgres','supabase_admin') and current_setting('app.china_workorder',true)='on' and app.basic_work_allowed('china') and (to_jsonb(new)-array['sample_work_order_shipped','sample_work_order_shipped_at'])=(to_jsonb(old)-array['sample_work_order_shipped','sample_work_order_shipped_at'])) then raise exception '기획안 작성자만 구성 정보를 변경할 수 있습니다.' using errcode='42501'; end if;
 if tg_op='UPDATE' and new.draft_id is distinct from old.draft_id then raise exception '기획안 연결은 변경할 수 없습니다.'; end if;
 if not exists(select 1 from public.product_drafts d where d.id=parent_id and d.company_id=new.company_id and d.brand_id is not distinct from new.brand_id) then raise exception '기획안 구성 정보의 회사·브랜드가 맞지 않습니다.' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger draft_color_owner_guard before insert or update on public.draft_colors for each row execute function app.guard_draft_child_owner();
create trigger draft_option_owner_guard before insert or update on public.draft_options for each row execute function app.guard_draft_child_owner();

drop policy "product_drafts_delete" on public.product_drafts;

drop policy "product_drafts_insert" on public.product_drafts;

drop policy "product_drafts_update" on public.product_drafts;
create policy draft_owner_insert on public.product_drafts for insert to authenticated with check (app.basic_work_allowed('planning',brand_id) and created_by=auth.uid());
 create policy draft_owner_update on public.product_drafts for update to authenticated using (app.draft_write_allowed(id)) with check (app.draft_write_allowed(id));
 create policy draft_owner_delete on public.product_drafts for delete to authenticated using (app.draft_write_allowed(id));

drop policy "draft_colors_delete" on public.draft_colors;

drop policy "draft_colors_insert" on public.draft_colors;

drop policy "draft_colors_update" on public.draft_colors;
create policy draft_owner_insert on public.draft_colors for insert to authenticated with check (app.draft_write_allowed(draft_id));
 create policy draft_owner_update on public.draft_colors for update to authenticated using (app.draft_write_allowed(draft_id)) with check (app.draft_write_allowed(draft_id));
 create policy draft_owner_delete on public.draft_colors for delete to authenticated using (app.draft_write_allowed(draft_id));

drop policy "draft_options_delete" on public.draft_options;

drop policy "draft_options_insert" on public.draft_options;

drop policy "draft_options_update" on public.draft_options;
create policy draft_owner_insert on public.draft_options for insert to authenticated with check (app.draft_write_allowed(draft_id));
 create policy draft_owner_update on public.draft_options for update to authenticated using (app.draft_write_allowed(draft_id)) with check (app.draft_write_allowed(draft_id));
 create policy draft_owner_delete on public.draft_options for delete to authenticated using (app.draft_write_allowed(draft_id));

CREATE OR REPLACE FUNCTION public.save_product_draft(p_company_id uuid, p_brand_id uuid, p_id uuid, p_payload jsonb, p_colors jsonb, p_options jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  v_draft_no text;
  v_status text;
  v_season_id uuid;
  v_style_id uuid;
  v_existing public.product_drafts%rowtype;
  color jsonb;
  opt jsonb;
  i integer;
  child_id uuid;
begin
  if not (p_company_id='e0000000-0000-4000-8000-000000000001' and case when p_id is null then app.basic_work_allowed('planning',p_brand_id) else app.draft_write_allowed(p_id) end) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;
  if not app.draft_brand_in_company(p_company_id, p_brand_id) then
    raise exception '다른 회사 브랜드에는 배정할 수 없습니다.';
  end if;

  v_status := coalesce(p_payload->>'status', 'open');
  if v_status = 'confirmed' and p_brand_id is null then
    raise exception '출시 확정 전에 브랜드를 지정하세요.';
  end if;

  v_season_id := nullif(p_payload->>'seasonId', '')::uuid;
  if v_season_id is not null then
    if p_brand_id is null then
      raise exception '브랜드를 정한 뒤에만 출시 기획을 연결할 수 있습니다.';
    end if;
    if not exists (
      select 1 from public.seasons s
      where s.id = v_season_id and s.brand_id = p_brand_id
    ) then
      raise exception '출시 기획이 선택한 브랜드와 맞지 않습니다.';
    end if;
  end if;

  for opt in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    v_style_id := nullif(opt->>'styleId', '')::uuid;
    if v_style_id is not null then
      if p_brand_id is null then
        raise exception '브랜드를 정한 뒤에만 기존 상품을 연결할 수 있습니다.';
      end if;
      if not exists (
        select 1 from public.styles s
        where s.id = v_style_id and s.brand_id = p_brand_id
      ) then
        raise exception '옵션 상품이 선택한 브랜드와 맞지 않습니다.';
      end if;
    end if;
  end loop;

  if p_id is null then
    v_draft_no := public.issue_draft_no(p_company_id);
    insert into public.product_drafts (
      company_id, brand_id, season_id, draft_no, status, owner, name_ko, name_en, image_url,
      sample_work_order_url, sample_work_order_name, sample_work_orders,
      sample_done, order_done, order_in_progress, photo_sample_done, held, hold_reason, held_at,
      target_cost, cost_currency, cost_confirmed, retail_price, discount_price,
      origin_country, register_type, open_type, open_type_detail, release_issue,
      specs, has_options, note
    ) values (
      p_company_id, p_brand_id, v_season_id, v_draft_no, v_status,
      coalesce(p_payload->>'owner', ''),
      coalesce(p_payload->>'nameKo', ''),
      coalesce(p_payload->>'nameEn', ''),
      nullif(p_payload->>'imageUrl', ''),
      nullif(p_payload->>'sampleWorkOrderUrl', ''),
      coalesce(p_payload->>'sampleWorkOrderName', ''),
      coalesce(p_payload->'sampleWorkOrders', '[]'::jsonb),
      coalesce((p_payload->>'sampleDone')::boolean, false),
      coalesce((p_payload->>'orderDone')::boolean, false),
      coalesce((p_payload->>'orderInProgress')::boolean, false),
      coalesce((p_payload->>'photoSampleDone')::boolean, false),
      coalesce((p_payload->>'held')::boolean, false),
      coalesce(p_payload->>'holdReason', ''),
      case when coalesce((p_payload->>'held')::boolean, false)
        then coalesce((p_payload->>'heldAt')::timestamptz, now()) else null end,
      nullif(p_payload->>'targetCost', '')::numeric,
      coalesce(p_payload->>'costCurrency', 'CNY'),
      coalesce((p_payload->>'costConfirmed')::boolean, false),
      nullif(p_payload->>'retailPrice', '')::numeric,
      nullif(p_payload->>'discountPrice', '')::numeric,
      coalesce(p_payload->>'originCountry', ''),
      coalesce(p_payload->>'registerType', ''),
      coalesce(p_payload->>'openType', ''),
      coalesce(p_payload->>'openTypeDetail', ''),
      coalesce(p_payload->>'releaseIssue', ''),
      coalesce(p_payload->'specs', '{}'::jsonb),
      coalesce((p_payload->>'hasOptions')::boolean, false),
      coalesce(p_payload->>'note', '')
    )
    returning id into v_id;
  else
    select * into v_existing
    from public.product_drafts
    where id = p_id and company_id = p_company_id
    for update;
    if not found then
      raise exception '기획안을 찾을 수 없습니다.';
    end if;
    if nullif(p_payload->>'expectedUpdatedAt','') is not null and v_existing.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then
      raise exception '다른 직원이 기획안을 수정했습니다. 다시 조회해 주세요.' using errcode='40001';
    end if;
    -- Legacy deployed clients send a whole draft without a revision. Preserve Chinese-only
    -- progress when the linked document is unchanged, instead of overwriting it with a stale snapshot.
    p_payload := jsonb_set(p_payload,'{sampleWorkOrders}',coalesce((
      select jsonb_agg(n.value || coalesce((select jsonb_build_object('assigneeId',o.value->'assigneeId','assigneeName',o.value->'assigneeName','fileCheckedAt',o.value->'fileCheckedAt','returnedAt',o.value->'returnedAt') from jsonb_array_elements(v_existing.sample_work_orders) o where o.value->>'id'=n.value->>'id' and o.value->>'url'=n.value->>'url' limit 1),'{}') order by n.ordinality)
      from jsonb_array_elements(coalesce(p_payload->'sampleWorkOrders','[]')) with ordinality n(value,ordinality)), '[]'));
    p_colors := coalesce((select jsonb_agg(n.value || coalesce((select jsonb_build_object('sampleWorkOrderShipped',c.sample_work_order_shipped,'sampleWorkOrderShippedAt',c.sample_work_order_shipped_at) from public.draft_colors c where c.draft_id=p_id and c.id::text=n.value->>'id' and c.sample_work_order_url=n.value->>'sampleWorkOrderUrl' limit 1),'{}') order by n.ordinality) from jsonb_array_elements(p_colors) with ordinality n(value,ordinality)), '[]');
    if jsonb_typeof(p_payload->'specs'->'colorSampleRounds')='array' then
      p_payload := jsonb_set(p_payload,'{specs,colorSampleRounds}',coalesce((
        select jsonb_agg(n.value || coalesce((select jsonb_build_object('returnedAt',o.value->'returnedAt')
          from jsonb_array_elements(coalesce(v_existing.specs->'colorSampleRounds','[]')) o
          where o.value->>'id'=n.value->>'id' and o.value->>'url'=n.value->>'url' limit 1),'{}') order by n.ordinality)
        from jsonb_array_elements(p_payload->'specs'->'colorSampleRounds') with ordinality n(value,ordinality)), '[]'));
    end if;
    if v_existing.status = 'confirmed'
      and v_existing.brand_id is distinct from p_brand_id then
      raise exception '출시 확정된 기획안은 브랜드를 바꿀 수 없습니다.';
    end if;

    update public.product_drafts set
      brand_id = p_brand_id,
      season_id = v_season_id,
      status = v_status,
      owner = coalesce(p_payload->>'owner', ''),
      name_ko = coalesce(p_payload->>'nameKo', ''),
      name_en = coalesce(p_payload->>'nameEn', ''),
      image_url = nullif(p_payload->>'imageUrl', ''),
      sample_work_order_url = nullif(p_payload->>'sampleWorkOrderUrl', ''),
      sample_work_order_name = coalesce(p_payload->>'sampleWorkOrderName', ''),
      sample_work_orders = coalesce(p_payload->'sampleWorkOrders', '[]'::jsonb),
      sample_done = coalesce((p_payload->>'sampleDone')::boolean, false),
      order_done = coalesce((p_payload->>'orderDone')::boolean, false),
      order_in_progress = coalesce((p_payload->>'orderInProgress')::boolean, false),
      photo_sample_done = coalesce((p_payload->>'photoSampleDone')::boolean, false),
      held = coalesce((p_payload->>'held')::boolean, false),
      hold_reason = coalesce(p_payload->>'holdReason', ''),
      held_at = case when coalesce((p_payload->>'held')::boolean, false)
        then coalesce(held_at, coalesce((p_payload->>'heldAt')::timestamptz, now()))
        else null end,
      target_cost = nullif(p_payload->>'targetCost', '')::numeric,
      cost_currency = coalesce(p_payload->>'costCurrency', 'CNY'),
      cost_confirmed = coalesce((p_payload->>'costConfirmed')::boolean, false),
      retail_price = nullif(p_payload->>'retailPrice', '')::numeric,
      discount_price = nullif(p_payload->>'discountPrice', '')::numeric,
      origin_country = coalesce(p_payload->>'originCountry', ''),
      register_type = coalesce(p_payload->>'registerType', ''),
      open_type = coalesce(p_payload->>'openType', ''),
      open_type_detail = coalesce(p_payload->>'openTypeDetail', ''),
      release_issue = coalesce(p_payload->>'releaseIssue', ''),
      specs = coalesce(p_payload->'specs', '{}'::jsonb),
      has_options = coalesce((p_payload->>'hasOptions')::boolean, false),
      note = coalesce(p_payload->>'note', ''),
      updated_at = now()
    where id = p_id and company_id = p_company_id
    returning id into v_id;

    delete from public.draft_colors where draft_id = v_id;
    delete from public.draft_options where draft_id = v_id;
  end if;

  i := 0;
  for color in select * from jsonb_array_elements(coalesce(p_colors, '[]'::jsonb))
  loop
    i := i + 1;
    begin
      child_id := nullif(color->>'id', '')::uuid;
    exception when others then
      child_id := null;
    end;
    insert into public.draft_colors (
      id, company_id, brand_id, draft_id, name, order_qty, sample_in_progress,
      sample_work_order_url, sample_work_order_name,
      sample_work_order_shipped, sample_work_order_shipped_at, sort_order
    ) values (
      coalesce(child_id, gen_random_uuid()),
      p_company_id,
      p_brand_id,
      v_id,
      coalesce(color->>'name', ''),
      nullif(color->>'orderQty', '')::int,
      coalesce((color->>'sampleInProgress')::boolean, false),
      nullif(color->>'sampleWorkOrderUrl', ''),
      coalesce(color->>'sampleWorkOrderName', ''),
      coalesce((color->>'sampleWorkOrderShipped')::boolean, false),
      case when coalesce((color->>'sampleWorkOrderShipped')::boolean, false)
        then coalesce(
          nullif(color->>'sampleWorkOrderShippedAt', '')::timestamptz,
          now()
        )
        else null end,
      i
    );
  end loop;

  i := 0;
  for opt in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    i := i + 1;
    begin
      child_id := nullif(opt->>'id', '')::uuid;
    exception when others then
      child_id := null;
    end;
    insert into public.draft_options (
      id, company_id, brand_id, draft_id, style_id, name, price, sort_order
    ) values (
      coalesce(child_id, gen_random_uuid()),
      p_company_id,
      p_brand_id,
      v_id,
      nullif(opt->>'styleId', '')::uuid,
      coalesce(opt->>'name', ''),
      nullif(opt->>'price', '')::numeric,
      i
    );
  end loop;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_draft_no(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  max_used integer;
  next_value integer;
begin
  if not (p_company_id='e0000000-0000-4000-8000-000000000001' and (app.basic_work_allowed('planning') or exists(select 1 from public.brands b where b.company_id=p_company_id and app.basic_work_allowed('planning',b.id)))) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;

  select coalesce(max(nullif(substring(draft_no from '^PL-(\d+)$'), '')::int), 0)
  into max_used
  from public.product_drafts
  where company_id = p_company_id;

  insert into public.company_draft_sequences (company_id, last_value)
  values (p_company_id, max_used + 1)
  on conflict (company_id) do update
    set last_value = greatest(public.company_draft_sequences.last_value, max_used) + 1,
        updated_at = now()
  returning last_value into next_value;

  return 'PL-' || lpad(next_value::text, 4, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.promote_product_draft(p_draft_id uuid, p_style_no text, p_season_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  d public.product_drafts%rowtype;
  v_season_id uuid;
  v_style_id uuid;
  v_colors text[];
  v_name text;
begin
  select * into d from public.product_drafts where id = p_draft_id for update;
  if not found then
    raise exception '기획안을 찾을 수 없습니다.';
  end if;
  if not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;
  if d.brand_id is null then
    raise exception '상품으로 넘기기 전에 브랜드를 지정하세요.';
  end if;
  if d.promoted_style_id is not null then
    return d.promoted_style_id;
  end if;

  v_season_id := coalesce(p_season_id, d.season_id);
  if v_season_id is null then
    raise exception '출시 기획을 먼저 연결하세요.';
  end if;

  v_name := nullif(trim(d.name_ko), '');
  if v_name is null then
    v_name := nullif(trim(d.name_en), '');
  end if;
  if v_name is null then
    v_name := d.draft_no;
  end if;

  if nullif(trim(p_style_no), '') is null then
    raise exception '품번을 입력하세요.';
  end if;

  select coalesce(array_agg(name order by sort_order) filter (where nullif(trim(name), '') is not null), '{}')
  into v_colors
  from public.draft_colors
  where draft_id = d.id;

  insert into public.styles (
    brand_id, season_id, style_no, name, gender, colors,
    target_cost, retail_price, status, planner, designer
  ) values (
    d.brand_id, v_season_id, trim(p_style_no), v_name, 'U',
    to_jsonb(v_colors), d.target_cost, d.retail_price, 'confirmed',
    nullif(trim(d.owner), ''), null
  )
  returning id into v_style_id;

  update public.product_drafts
  set status = 'confirmed',
      season_id = v_season_id,
      promoted_style_id = v_style_id,
      updated_at = now()
  where id = d.id;

  return v_style_id;
end;
$function$
;

-- Restrict newly allowed product edits to fields owned by the user's department.
create or replace function app.guard_basic_style_fields() returns trigger language plpgsql set search_path='' as $$
declare k text; field_key text; field_owner text; nested_key text;
begin
 if new.brand_id is distinct from old.brand_id or new.id<>old.id then raise exception '상품 소속은 변경할 수 없습니다.' using errcode='42501'; end if;
 if new.season_id is not null and not exists(select 1 from public.seasons s where s.id=new.season_id and s.brand_id=new.brand_id) then raise exception '상품과 출시 기획의 브랜드가 다릅니다.' using errcode='42501'; end if;
 if app.can_edit_brand(old.brand_id) or app.work_operator() then return new; end if;
 for k in select key from jsonb_each(to_jsonb(new)-array['updated_at','values','custom_fields']) n where n.value is distinct from to_jsonb(old)->n.key loop
  field_key:=case k when 'weight_g' then 'weightG' when 'retail_price' then 'retailPrice' when 'planned_qty' then 'plannedQty' when 'target_cost' then 'targetCost' when 'style_no' then 'styleNo' when 'season_id' then 'seasonCode' else k end;
  select f.owner into field_owner from public.brand_fields f where f.brand_id=old.brand_id and f.system_key=field_key limit 1;
  if field_owner is null or not app.basic_work_allowed(field_owner,old.brand_id) then raise exception '다른 부서 상품 항목은 수정할 수 없습니다: %',field_key using errcode='42501'; end if;
 end loop;
 for k in select unnest(array['values','custom_fields']) loop
  for nested_key in select key from jsonb_each(coalesce(to_jsonb(old)->k,'{}')||coalesce(to_jsonb(new)->k,'{}')) loop
   if to_jsonb(old)->k->nested_key is not distinct from to_jsonb(new)->k->nested_key then continue; end if;
   select f.owner into field_owner from public.brand_fields f where f.brand_id=old.brand_id and (f.system_key=nested_key or f.id::text=nested_key) limit 1;
   if field_owner is null or not app.basic_work_allowed(field_owner,old.brand_id) then raise exception '다른 부서 상품 항목은 수정할 수 없습니다: %',nested_key using errcode='42501'; end if;
  end loop;
 end loop;
 return new;
end $$;
create trigger basic_style_fields_guard before update on public.styles for each row execute function app.guard_basic_style_fields();
create policy basic_style_update on public.styles for update to authenticated using (app.basic_work_allowed('md',brand_id) or app.basic_work_allowed('logistics',brand_id) or app.work_operator()) with check (app.basic_work_allowed('md',brand_id) or app.basic_work_allowed('logistics',brand_id) or app.work_operator());
create policy basic_season_insert on public.seasons for insert to authenticated with check (app.basic_work_allowed('planning',brand_id));
create policy basic_season_update on public.seasons for update to authenticated using (app.basic_work_allowed('planning',brand_id)) with check (app.basic_work_allowed('planning',brand_id));
create policy basic_work_insert on public.invoice_product_name_exclusions for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_product_name_exclusions for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_instruction_products for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_instruction_products for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_name_rules for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_name_rules for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_option_map_components for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_option_map_components for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_option_maps for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_option_maps for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_prefix_items for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_prefix_items for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_product_name_tag_roles for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_product_name_tag_roles for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_prefix_requests for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_prefix_requests for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_product_name_maps for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_product_name_maps for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_item_name_rule_components for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_item_name_rule_components for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_gift_source_maps for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_gift_source_maps for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_prefix_item_products for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_prefix_item_products for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_item_name_rules for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_item_name_rules for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_accessory_rules for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_accessory_rules for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_instructions for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_instructions for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_instruction_items for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_instruction_items for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.product_code_components for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.product_code_components for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_gift_quotas for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_gift_quotas for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.product_codes for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.product_codes for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_gift_allocations for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_gift_allocations for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_gift_source_map_products for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_gift_source_map_products for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_gift_source_allocations for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_gift_source_allocations for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_packing_size_maps for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_packing_size_maps for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouse_stock_positions for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.warehouse_stock_positions for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouse_inventory_sets for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.warehouse_inventory_sets for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouse_stock_movements for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.warehouse_stock_movements for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_picking_route_presets for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_picking_route_presets for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_runs for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_runs for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_site_summaries for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_site_summaries for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_preorder_holds for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_preorder_holds for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_discontinued_styles for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_discontinued_styles for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_preorder_hold_extensions for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_preorder_hold_extensions for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.bulk_outbound_partner_configs for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.bulk_outbound_partner_configs for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.bulk_outbound_jobs for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.bulk_outbound_jobs for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.bulk_outbound_job_files for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.bulk_outbound_job_files for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.bulk_outbound_job_lines for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.bulk_outbound_job_lines for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.outbound_shipments for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.outbound_shipments for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.bulk_outbound_template_fields for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.bulk_outbound_template_fields for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.barcode_partner_display_settings for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.barcode_partner_display_settings for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.barcode_partner_display_targets for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.barcode_partner_display_targets for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.invoice_work_run_order_keys for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.invoice_work_run_order_keys for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.outbound_partner_groups for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.outbound_partner_groups for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.barcode_data_entry_runs for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.barcode_data_entry_runs for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.cargo_inbound_shipments for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.cargo_inbound_shipments for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.cargo_inbound_lines for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.cargo_inbound_lines for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouse_boxes for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.warehouse_boxes for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouse_box_movements for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.warehouse_box_movements for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.cargo_inbound_tidy_rows for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.cargo_inbound_tidy_rows for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.warehouses for insert to authenticated with check (exists(select 1 from public.brands b where b.company_id=warehouses.company_id and app.basic_work_allowed('logistics',b.id)));
create policy basic_work_update on public.warehouses for update to authenticated using (exists(select 1 from public.brands b where b.company_id=warehouses.company_id and app.basic_work_allowed('logistics',b.id))) with check (exists(select 1 from public.brands b where b.company_id=warehouses.company_id and app.basic_work_allowed('logistics',b.id)));
create policy basic_work_insert on public.warehouse_locations for insert to authenticated with check (exists(select 1 from public.brands b where b.company_id=warehouse_locations.company_id and app.basic_work_allowed('logistics',b.id)));
create policy basic_work_update on public.warehouse_locations for update to authenticated using (exists(select 1 from public.brands b where b.company_id=warehouse_locations.company_id and app.basic_work_allowed('logistics',b.id))) with check (exists(select 1 from public.brands b where b.company_id=warehouse_locations.company_id and app.basic_work_allowed('logistics',b.id)));
create policy basic_work_insert on public.warehouse_registered_slots for insert to authenticated with check (exists(select 1 from public.warehouses w join public.brands b on b.company_id=w.company_id where w.id=warehouse_id and app.basic_work_allowed('logistics',b.id)));
create policy basic_work_update on public.warehouse_registered_slots for update to authenticated using (exists(select 1 from public.warehouses w join public.brands b on b.company_id=w.company_id where w.id=warehouse_id and app.basic_work_allowed('logistics',b.id))) with check (exists(select 1 from public.warehouses w join public.brands b on b.company_id=w.company_id where w.id=warehouse_id and app.basic_work_allowed('logistics',b.id)));

CREATE OR REPLACE FUNCTION public.save_invoice_packing_size_maps(p_brand_id uuid, p_field_id uuid, p_mappings jsonb)
 RETURNS SETOF invoice_packing_size_maps
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_source_value text;
  v_normalized_source_value text;
  v_display_value text;
begin
  if p_brand_id is null or p_field_id is null then
    raise exception '포장 규격 항목을 지정하세요.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 포장 규격 매핑을 저장할 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.brand_fields
    where brand_id = p_brand_id
      and id = p_field_id
  ) then
    raise exception '포장 규격 항목을 찾을 수 없습니다.';
  end if;
  if p_mappings is not null and jsonb_typeof(p_mappings) <> 'array' then
    raise exception '포장 규격 매핑 형식이 올바르지 않습니다.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_mappings, '[]'::jsonb))
  loop
    v_source_value := btrim(coalesce(v_item ->> 'source_value', ''));
    v_normalized_source_value := app.normalize_select_label(v_source_value);
    v_display_value := btrim(coalesce(v_item ->> 'display_value', ''));

    if v_source_value = '' or v_normalized_source_value = '' then
      raise exception '원본 포장 규격을 입력하세요.';
    end if;

    if v_display_value = '' then
      delete from public.invoice_packing_size_maps
      where brand_id = p_brand_id
        and field_id = p_field_id
        and normalized_source_value = v_normalized_source_value;
    else
      insert into public.invoice_packing_size_maps (
        brand_id,
        field_id,
        source_value,
        normalized_source_value,
        display_value
      )
      values (
        p_brand_id,
        p_field_id,
        v_source_value,
        v_normalized_source_value,
        v_display_value
      )
      on conflict (
        brand_id,
        field_id,
        normalized_source_value
      )
      do update set
        source_value = excluded.source_value,
        display_value = excluded.display_value;
    end if;
  end loop;

  return query
    select mapping.*
    from public.invoice_packing_size_maps as mapping
    where mapping.brand_id = p_brand_id
      and mapping.field_id = p_field_id
    order by mapping.source_value;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_bulk_outbound_template_fields(p_brand_id uuid, p_usage_target_id uuid, p_barcode_source text, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  field jsonb;
  field_count integer;
  field_order integer := 0;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_barcode_source not in ('own', 'partner') then
    raise exception '올바르지 않은 바코드 출처입니다.';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception '양식 헤더 배열이 필요합니다.';
  end if;

  field_count := jsonb_array_length(p_fields);
  if field_count < 1 or field_count > 100 then
    raise exception '양식 헤더는 1개 이상 100개 이하로 저장하세요.';
  end if;

  if not exists (
    select 1
    from public.code_usage_targets
    where brand_id = p_brand_id
      and id = p_usage_target_id
  ) then
    raise exception '같은 브랜드의 출고업체를 찾지 못했습니다.';
  end if;

  delete from public.bulk_outbound_template_fields
  where brand_id = p_brand_id
    and usage_target_id = p_usage_target_id
    and barcode_source = p_barcode_source;

  for field in select value from jsonb_array_elements(p_fields)
  loop
    if length(btrim(coalesce(field->>'id', ''))) not between 1 and 200 then
      raise exception '양식 헤더 식별자가 올바르지 않습니다.';
    end if;
    if length(btrim(coalesce(field->>'label', ''))) not between 1 and 120 then
      raise exception '양식 헤더 이름이 올바르지 않습니다.';
    end if;

    insert into public.bulk_outbound_template_fields (
      brand_id,
      usage_target_id,
      barcode_source,
      field_key,
      label,
      sort_order
    ) values (
      p_brand_id,
      p_usage_target_id,
      p_barcode_source,
      btrim(field->>'id'),
      btrim(field->>'label'),
      field_order
    );

    field_order := field_order + 1;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_invoice_gift_allocations(p_brand_id uuid, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_candidate jsonb;
  v_group record;
  v_group_candidates jsonb;
  v_request_ids uuid[] := array[]::uuid[];
  v_request_id uuid;
  v_item_id uuid;
  v_style_id uuid;
  v_mall_name text;
  v_customer_order_no text;
  v_ordered_at timestamp;
  v_fingerprint text;
  v_allocation_key text;
  v_slot integer;
  v_source_file text;
  v_existing public.invoice_gift_allocations%rowtype;
  v_limit_mode text;
  v_total_limit integer;
  v_new_count integer;
  v_used integer;
  v_reason text;
  v_result jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 사은품 배정을 확정할 권한이 없습니다.';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception '배정 후보 목록이 필요합니다.';
  end if;

  for v_candidate in
    select value from jsonb_array_elements(p_candidates)
  loop
    v_request_id := (v_candidate->>'request_id')::uuid;
    if v_request_id is not null
      and not (v_request_id = any (v_request_ids))
    then
      v_request_ids := array_append(v_request_ids, v_request_id);
    end if;
  end loop;

  perform 1
  from public.invoice_prefix_requests r
  where r.brand_id = p_brand_id
    and r.id = any (v_request_ids)
  order by r.id
  for update;

  for v_group in
    select
      (e.value->>'request_id')::uuid as request_id,
      coalesce(
        nullif(btrim(e.value->>'atomic_group_key'), ''),
        btrim(e.value->>'allocation_key')
      ) as group_key,
      min(e.ordinality) as first_ordinality
    from jsonb_array_elements(p_candidates)
      with ordinality as e(value, ordinality)
    group by 1, 2
    order by min(e.ordinality)
  loop
    select jsonb_agg(e.value order by e.ordinality)
    into v_group_candidates
    from jsonb_array_elements(p_candidates)
      with ordinality as e(value, ordinality)
    where (e.value->>'request_id')::uuid = v_group.request_id
      and coalesce(
        nullif(btrim(e.value->>'atomic_group_key'), ''),
        btrim(e.value->>'allocation_key')
      ) = v_group.group_key;

    v_reason := null;
    if not exists (
      select 1
      from public.invoice_prefix_requests r
      where r.brand_id = p_brand_id
        and r.id = v_group.request_id
    ) then
      raise exception '사은품 요청 건을 찾지 못했습니다.';
    end if;

    select
      r.first_come_limit_mode,
      r.first_come_total_limit
    into v_limit_mode, v_total_limit
    from public.invoice_prefix_requests r
    where r.brand_id = p_brand_id
      and r.id = v_group.request_id
      and r.uses_first_come;

    if not found then
      v_reason := 'first_come_disabled';
    end if;

    v_new_count := 0;
    if v_reason is null then
      for v_candidate in
        select value from jsonb_array_elements(v_group_candidates)
      loop
        v_request_id := (v_candidate->>'request_id')::uuid;
        v_item_id := (v_candidate->>'item_id')::uuid;
        v_style_id := (v_candidate->>'style_id')::uuid;
        v_fingerprint := btrim(coalesce(v_candidate->>'order_fingerprint', ''));
        v_allocation_key :=
          btrim(coalesce(v_candidate->>'allocation_key', ''));
        v_slot := coalesce((v_candidate->>'gift_slot_index')::integer, 1);

        if v_request_id is null or v_request_id <> v_group.request_id
          or v_item_id is null or v_style_id is null
          or v_fingerprint = '' or v_allocation_key = '' or v_slot < 1
        then
          raise exception '배정 후보에 필수값이 빠졌습니다.';
        end if;

        if not exists (
          select 1
          from public.invoice_prefix_items i
          join public.invoice_prefix_item_products p
            on p.brand_id = i.brand_id
           and p.item_id = i.id
           and p.style_id = v_style_id
          where i.brand_id = p_brand_id
            and i.request_id = v_request_id
            and i.id = v_item_id
        ) then
          raise exception '요청 건에 등록되지 않은 사은품 배정 후보입니다.';
        end if;

        select *
        into v_existing
        from public.invoice_gift_allocations a
        where a.brand_id = p_brand_id
          and a.request_id = v_request_id
          and a.allocation_key = v_allocation_key;

        if found then
          if v_existing.cancelled_at is not null then
            v_reason := 'cancelled';
            exit;
          end if;
        else
          v_new_count := v_new_count + 1;
        end if;
      end loop;
    end if;

    if v_reason is null and v_new_count > 0 then
      if v_limit_mode = 'shared_total' then
        if v_total_limit is null then
          v_reason := 'no_quota';
        else
          select count(*)::integer
          into v_used
          from public.invoice_gift_allocations a
          where a.brand_id = p_brand_id
            and a.request_id = v_group.request_id
            and a.cancelled_at is null;

          if v_used + v_new_count > v_total_limit then
            v_reason := 'quota_exhausted';
          end if;
        end if;
      else
        if exists (
          select 1
          from (
            select
              (c.value->>'style_id')::uuid as style_id,
              count(*)::integer as needed
            from jsonb_array_elements(v_group_candidates) as c(value)
            where not exists (
              select 1
              from public.invoice_gift_allocations a
              where a.brand_id = p_brand_id
                and a.request_id = v_group.request_id
                and a.allocation_key =
                  btrim(c.value->>'allocation_key')
            )
            group by 1
          ) n
          left join public.invoice_gift_quotas q
            on q.brand_id = p_brand_id
           and q.request_id = v_group.request_id
           and q.style_id = n.style_id
          where q.id is null
        ) then
          v_reason := 'no_quota';
        elsif exists (
          select 1
          from (
            select
              (c.value->>'style_id')::uuid as style_id,
              count(*)::integer as needed
            from jsonb_array_elements(v_group_candidates) as c(value)
            where not exists (
              select 1
              from public.invoice_gift_allocations a
              where a.brand_id = p_brand_id
                and a.request_id = v_group.request_id
                and a.allocation_key =
                  btrim(c.value->>'allocation_key')
            )
            group by 1
          ) n
          join public.invoice_gift_quotas q
            on q.brand_id = p_brand_id
           and q.request_id = v_group.request_id
           and q.style_id = n.style_id
          where (
            select count(*)::integer
            from public.invoice_gift_allocations a
            where a.brand_id = p_brand_id
              and a.request_id = v_group.request_id
              and a.style_id = n.style_id
              and a.cancelled_at is null
          ) + n.needed > q.quantity_limit
        ) then
          v_reason := 'quota_exhausted';
        end if;
      end if;
    end if;

    if v_reason is not null then
      for v_candidate in
        select value from jsonb_array_elements(v_group_candidates)
      loop
        v_skipped := v_skipped || jsonb_build_object(
          'allocation_key', btrim(v_candidate->>'allocation_key'),
          'reason', v_reason
        );
      end loop;
      continue;
    end if;

    for v_candidate in
      select value from jsonb_array_elements(v_group_candidates)
    loop
      v_request_id := (v_candidate->>'request_id')::uuid;
      v_item_id := (v_candidate->>'item_id')::uuid;
      v_style_id := (v_candidate->>'style_id')::uuid;
      v_mall_name := coalesce(v_candidate->>'mall_name', '');
      v_customer_order_no :=
        coalesce(v_candidate->>'customer_order_no', '');
      v_fingerprint := btrim(coalesce(v_candidate->>'order_fingerprint', ''));
      v_allocation_key :=
        btrim(coalesce(v_candidate->>'allocation_key', ''));
      v_slot := coalesce((v_candidate->>'gift_slot_index')::integer, 1);
      v_source_file := coalesce(v_candidate->>'source_file_name', '');

      if v_candidate ? 'ordered_at'
        and nullif(btrim(v_candidate->>'ordered_at'), '') is not null
      then
        v_ordered_at := (v_candidate->>'ordered_at')::timestamp;
      else
        v_ordered_at := null;
      end if;

      select *
      into v_existing
      from public.invoice_gift_allocations a
      where a.brand_id = p_brand_id
        and a.request_id = v_request_id
        and a.allocation_key = v_allocation_key;

      if found then
        v_result := v_result || jsonb_build_object(
          'id', v_existing.id,
          'request_id', v_existing.request_id,
          'item_id', v_existing.item_id,
          'style_id', v_existing.style_id,
          'mall_name', v_existing.mall_name,
          'customer_order_no', v_existing.customer_order_no,
          'ordered_at',
            to_char(v_existing.ordered_at, 'YYYY-MM-DD HH24:MI'),
          'order_fingerprint', v_existing.order_fingerprint,
          'allocation_key', v_existing.allocation_key,
          'gift_slot_index', v_existing.gift_slot_index,
          'reused', true
        );
        continue;
      end if;

      insert into public.invoice_gift_allocations (
        brand_id,
        request_id,
        item_id,
        style_id,
        mall_name,
        customer_order_no,
        ordered_at,
        order_fingerprint,
        allocation_key,
        gift_slot_index,
        source_file_name
      ) values (
        p_brand_id,
        v_request_id,
        v_item_id,
        v_style_id,
        v_mall_name,
        v_customer_order_no,
        v_ordered_at,
        v_fingerprint,
        v_allocation_key,
        v_slot,
        v_source_file
      )
      returning * into v_existing;

      v_result := v_result || jsonb_build_object(
        'id', v_existing.id,
        'request_id', v_existing.request_id,
        'item_id', v_existing.item_id,
        'style_id', v_existing.style_id,
        'mall_name', v_existing.mall_name,
        'customer_order_no', v_existing.customer_order_no,
        'ordered_at', to_char(v_existing.ordered_at, 'YYYY-MM-DD HH24:MI'),
        'order_fingerprint', v_existing.order_fingerprint,
        'allocation_key', v_existing.allocation_key,
        'gift_slot_index', v_existing.gift_slot_index,
        'reused', false
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'allocations', v_result,
    'skipped', v_skipped
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_invoice_product_name_map_with_feedback(p_brand_id uuid, p_row jsonb, p_map_id uuid DEFAULT NULL::uuid, p_feedback jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  v_lookup text := coalesce(btrim(p_row->>'lookup_key'), '');
  v_norm_lookup text := coalesce(btrim(p_row->>'normalized_lookup_key'), '');
  v_old_norm text := '';
  v_source text;
  v_keys text[];
  v_outcome text;
  v_suggested uuid;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if coalesce(btrim(p_row->>'product_name'), '') = '' or (p_row->>'style_id') is null then
    raise exception '원본 품목명과 본품을 입력하세요.';
  end if;

  if p_map_id is not null then
    v_id := p_map_id;
  elsif v_norm_lookup <> '' then
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_lookup_key = v_norm_lookup
    limit 1;
  else
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_mall_name = coalesce(p_row->>'normalized_mall_name', '')
      and m.normalized_product_name = coalesce(p_row->>'normalized_product_name', '')
      and m.normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', '')
      and m.normalized_lookup_key = ''
    limit 1;
  end if;

  if v_id is not null then
    select coalesce(m.normalized_lookup_key, '')
    into v_old_norm
    from public.invoice_product_name_maps m
    where m.id = v_id
      and m.brand_id = p_brand_id;
  end if;

  if v_id is null then
    insert into public.invoice_product_name_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      item_name_context,
      normalized_item_name_context,
      own_product_code,
      normalized_own_product_code,
      lookup_key,
      normalized_lookup_key,
      style_id,
      is_active,
      note
    ) values (
      p_brand_id,
      coalesce(p_row->>'mall_name', ''),
      coalesce(p_row->>'normalized_mall_name', ''),
      btrim(p_row->>'product_name'),
      coalesce(p_row->>'normalized_product_name', ''),
      coalesce(p_row->>'item_name_context', ''),
      coalesce(p_row->>'normalized_item_name_context', ''),
      coalesce(p_row->>'own_product_code', ''),
      coalesce(p_row->>'normalized_own_product_code', ''),
      v_lookup,
      v_norm_lookup,
      (p_row->>'style_id')::uuid,
      coalesce((p_row->>'is_active')::boolean, true),
      coalesce(p_row->>'note', '')
    )
    returning id into v_id;
  else
    update public.invoice_product_name_maps
    set
      mall_name = coalesce(p_row->>'mall_name', ''),
      normalized_mall_name = coalesce(p_row->>'normalized_mall_name', ''),
      product_name = btrim(p_row->>'product_name'),
      normalized_product_name = coalesce(p_row->>'normalized_product_name', ''),
      item_name_context = coalesce(p_row->>'item_name_context', ''),
      normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', ''),
      own_product_code = coalesce(p_row->>'own_product_code', ''),
      normalized_own_product_code = coalesce(p_row->>'normalized_own_product_code', ''),
      lookup_key = v_lookup,
      normalized_lookup_key = v_norm_lookup,
      style_id = (p_row->>'style_id')::uuid,
      is_active = coalesce((p_row->>'is_active')::boolean, true),
      note = coalesce(p_row->>'note', '')
    where id = v_id
      and brand_id = p_brand_id;
  end if;

  v_keys := array_remove(
    array[
      nullif(v_norm_lookup, ''),
      nullif(v_old_norm, ''),
      nullif(app.normalize_invoice_lookup_key(v_lookup), ''),
      nullif(app.normalize_invoice_lookup_key(p_row->>'product_name'), '')
    ],
    null
  );

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  v_suggested := nullif(p_feedback->>'suggested_style_id', '')::uuid;
  v_outcome := coalesce(nullif(btrim(p_feedback->>'outcome'), ''), 'confirmed');
  if v_source is not null and v_suggested is not null
     and v_suggested is distinct from (p_row->>'style_id')::uuid
     and v_outcome = 'confirmed' then
    v_outcome := 'corrected';
  end if;

  if v_source is not null then
    perform public.record_ai_recommendation_feedback(
      p_brand_id,
      case when v_lookup <> '' then v_lookup else btrim(p_row->>'product_name') end,
      (p_row->>'style_id')::uuid,
      v_source,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'shown_rank', '')::integer,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', ''),
      v_id,
      v_suggested,
      v_outcome
    );
    if v_old_norm <> '' and v_old_norm is distinct from v_norm_lookup then
      perform app.invalidate_ai_recommendation_cache(
        p_brand_id,
        'invoice_product_recommendation',
        array[v_old_norm]
      );
    end if;
  else
    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      'invoice_product_recommendation',
      v_keys
    );
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_invoice_gift_source_rows(p_brand_id uuid, p_map_id uuid, p_requests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_mode text;
  v_unique boolean;
  v_request jsonb;
  v_key text;
  v_fingerprint text;
  v_group text;
  v_slot integer;
  v_mall text;
  v_order_no text;
  v_ordered_at timestamp;
  v_file text;
  v_existing uuid;
  v_style_id uuid;
  v_pool uuid[];
  v_pick_pool uuid[];
  v_exclude uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_used jsonb := '{}'::jsonb;
  v_style uuid;
  v_min integer;
  v_candidates uuid[] := array[]::uuid[];
  v_hash bigint;
  v_pick integer;
  v_result jsonb := '[]'::jsonb;
begin
  if p_brand_id is null or p_map_id is null then
    raise exception 'brand_id와 map_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 사은품 원본행을 배정할 권한이 없습니다.';
  end if;
  if p_requests is null or jsonb_typeof(p_requests) <> 'array' then
    raise exception '배정 요청 목록이 필요합니다.';
  end if;

  select m.assignment_mode, m.unique_per_recipient
  into v_mode, v_unique
  from public.invoice_gift_source_maps m
  where m.brand_id = p_brand_id
    and m.id = p_map_id
    and m.is_active
  for update;
  if v_mode is null then
    raise exception '활성 사은품 원본행 매핑을 찾지 못했습니다.';
  end if;

  select coalesce(array_agg(p.style_id order by p.sort_order, p.style_id), array[]::uuid[])
  into v_pool
  from public.invoice_gift_source_map_products p
  where p.brand_id = p_brand_id
    and p.map_id = p_map_id;
  if cardinality(v_pool) = 0 then
    raise exception '후보 M번호가 없습니다.';
  end if;
  if v_mode = 'fixed' and cardinality(v_pool) <> 1 then
    raise exception '고정 배정 매핑의 후보가 1개가 아닙니다.';
  end if;

  for v_style in
    select unnest(v_pool)
  loop
    select count(*)::integer
    into v_min
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.map_id = p_map_id
      and a.style_id = v_style;
    v_counts := jsonb_set(v_counts, array[v_style::text], to_jsonb(v_min));
  end loop;

  for v_request in
    select value
    from jsonb_array_elements(p_requests)
    order by value->>'allocation_key'
  loop
    v_key := btrim(coalesce(v_request->>'allocation_key', ''));
    v_fingerprint := btrim(coalesce(v_request->>'order_fingerprint', ''));
    v_group := nullif(btrim(coalesce(v_request->>'uniqueness_group', '')), '');
    if v_group is null then
      v_group := v_fingerprint;
    end if;
    v_slot := coalesce((v_request->>'quantity_slot')::integer, 1);
    v_mall := coalesce(v_request->>'mall_name', '');
    v_order_no := coalesce(v_request->>'customer_order_no', '');
    v_ordered_at := nullif(v_request->>'ordered_at', '')::timestamp;
    v_file := coalesce(v_request->>'source_file_name', '');
    if v_key = '' or v_fingerprint = '' then
      raise exception 'allocation_key와 order_fingerprint가 필요합니다.';
    end if;

    select a.style_id
    into v_existing
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.allocation_key = v_key;
    if v_existing is not null then
      v_used := jsonb_set(
        v_used,
        array[v_group],
        coalesce(v_used->v_group, '[]'::jsonb) || jsonb_build_array(v_existing::text)
      );
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'allocation_key', v_key,
        'style_id', v_existing,
        'reused', true
      ));
      continue;
    end if;

    if v_mode = 'fixed' then
      v_style_id := v_pool[1];
    else
      v_exclude := array[]::uuid[];
      if coalesce(v_unique, false) then
        select coalesce(array_agg(distinct x), array[]::uuid[])
        into v_exclude
        from (
          select a.style_id as x
          from public.invoice_gift_source_allocations a
          where a.brand_id = p_brand_id
            and a.map_id = p_map_id
            and a.order_fingerprint = v_fingerprint
          union
          select value::uuid
          from jsonb_array_elements_text(coalesce(v_used->v_group, '[]'::jsonb))
        ) excluded;
      end if;

      v_pick_pool := v_pool;
      if cardinality(v_exclude) > 0 then
        select coalesce(array_agg(p), array[]::uuid[])
        into v_pick_pool
        from unnest(v_pool) as p
        where not (p = any (v_exclude));
        if v_pick_pool is null or cardinality(v_pick_pool) = 0 then
          v_pick_pool := v_pool;
        end if;
      end if;

      v_min := null;
      v_candidates := array[]::uuid[];
      foreach v_style in array v_pick_pool loop
        if v_min is null or (v_counts->>v_style::text)::integer < v_min then
          v_min := (v_counts->>v_style::text)::integer;
          v_candidates := array[v_style];
        elsif (v_counts->>v_style::text)::integer = v_min then
          v_candidates := array_append(v_candidates, v_style);
        end if;
      end loop;
      select array_agg(c order by c)
      into v_candidates
      from unnest(v_candidates) as c;
      v_hash := app.fnv1a_32_utf8(v_key);
      v_pick := (v_hash % cardinality(v_candidates))::integer + 1;
      v_style_id := v_candidates[v_pick];
    end if;

    insert into public.invoice_gift_source_allocations (
      brand_id,
      map_id,
      style_id,
      allocation_key,
      order_fingerprint,
      quantity_slot,
      mall_name,
      customer_order_no,
      ordered_at,
      source_file_name
    )
    values (
      p_brand_id,
      p_map_id,
      v_style_id,
      v_key,
      v_fingerprint,
      v_slot,
      v_mall,
      v_order_no,
      v_ordered_at,
      v_file
    );

    v_used := jsonb_set(
      v_used,
      array[v_group],
      coalesce(v_used->v_group, '[]'::jsonb) || jsonb_build_array(v_style_id::text)
    );
    v_counts := jsonb_set(
      v_counts,
      array[v_style_id::text],
      to_jsonb((v_counts->>v_style_id::text)::integer + 1)
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'allocation_key', v_key,
      'style_id', v_style_id,
      'reused', false
    ));
  end loop;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_invoice_gift_source_map(p_brand_id uuid, p_mall_name text, p_normalized_mall_name text, p_product_name text, p_normalized_product_name text, p_assignment_mode text, p_style_ids uuid[], p_is_active boolean DEFAULT true, p_note text DEFAULT ''::text, p_map_id uuid DEFAULT NULL::uuid, p_unique_per_recipient boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_map_id uuid;
  v_style_id uuid;
  v_index integer := 0;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 사은품 원본행 매핑을 저장할 권한이 없습니다.';
  end if;
  if btrim(coalesce(p_mall_name, '')) = ''
    or btrim(coalesce(p_normalized_mall_name, '')) = ''
  then
    raise exception '쇼핑몰명을 입력하세요.';
  end if;
  if btrim(coalesce(p_product_name, '')) = ''
    or btrim(coalesce(p_normalized_product_name, '')) = ''
  then
    raise exception '원본 품목명을 입력하세요.';
  end if;
  if p_assignment_mode not in ('fixed', 'balanced_random') then
    raise exception '배정 방식이 올바르지 않습니다.';
  end if;
  if p_style_ids is null or cardinality(p_style_ids) = 0 then
    raise exception '후보 M번호를 한 개 이상 고르세요.';
  end if;
  if p_assignment_mode = 'fixed' and cardinality(p_style_ids) <> 1 then
    raise exception '고정 배정은 M번호 1개만 고를 수 있습니다.';
  end if;

  if p_map_id is not null then
    update public.invoice_gift_source_maps
    set
      mall_name = btrim(p_mall_name),
      normalized_mall_name = btrim(p_normalized_mall_name),
      product_name = btrim(p_product_name),
      normalized_product_name = btrim(p_normalized_product_name),
      assignment_mode = p_assignment_mode,
      unique_per_recipient = coalesce(p_unique_per_recipient, true),
      is_active = coalesce(p_is_active, true),
      note = coalesce(p_note, '')
    where brand_id = p_brand_id
      and id = p_map_id
    returning id into v_map_id;
    if v_map_id is null then
      raise exception '사은품 원본행 매핑을 찾지 못했습니다.';
    end if;
  else
    insert into public.invoice_gift_source_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      assignment_mode,
      unique_per_recipient,
      is_active,
      note
    )
    values (
      p_brand_id,
      btrim(p_mall_name),
      btrim(p_normalized_mall_name),
      btrim(p_product_name),
      btrim(p_normalized_product_name),
      p_assignment_mode,
      coalesce(p_unique_per_recipient, true),
      coalesce(p_is_active, true),
      coalesce(p_note, '')
    )
    on conflict (brand_id, normalized_mall_name, normalized_product_name)
    do update set
      mall_name = excluded.mall_name,
      product_name = excluded.product_name,
      assignment_mode = excluded.assignment_mode,
      unique_per_recipient = excluded.unique_per_recipient,
      is_active = excluded.is_active,
      note = excluded.note
    returning id into v_map_id;
  end if;

  delete from public.invoice_gift_source_map_products
  where brand_id = p_brand_id
    and map_id = v_map_id
    and not (style_id = any (p_style_ids));

  foreach v_style_id in array p_style_ids loop
    insert into public.invoice_gift_source_map_products (
      brand_id,
      map_id,
      style_id,
      sort_order
    )
    values (
      p_brand_id,
      v_map_id,
      v_style_id,
      v_index
    )
    on conflict (map_id, style_id)
    do update set sort_order = excluded.sort_order;
    v_index := v_index + 1;
  end loop;

  return v_map_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_invoice_gift_source_allocations(p_brand_id uuid, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_candidate jsonb;
  v_map_ids uuid[] := array[]::uuid[];
  v_map_id uuid;
  v_style_id uuid;
  v_key text;
  v_fingerprint text;
  v_slot integer;
  v_mall text;
  v_order_no text;
  v_ordered_at timestamp;
  v_file text;
  v_existing uuid;
  v_in_pool boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 사은품 원본행을 확정할 권한이 없습니다.';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception '배정 확정 목록이 필요합니다.';
  end if;

  for v_candidate in
    select value from jsonb_array_elements(p_candidates)
  loop
    v_map_id := (v_candidate->>'map_id')::uuid;
    if v_map_id is not null and not (v_map_id = any (v_map_ids)) then
      v_map_ids := array_append(v_map_ids, v_map_id);
    end if;
  end loop;

  perform 1
  from public.invoice_gift_source_maps m
  where m.brand_id = p_brand_id
    and m.id = any (v_map_ids)
  order by m.id
  for update;

  for v_candidate in
    select value
    from jsonb_array_elements(p_candidates)
    order by value->>'allocation_key'
  loop
    v_map_id := (v_candidate->>'map_id')::uuid;
    v_style_id := (v_candidate->>'style_id')::uuid;
    v_key := btrim(coalesce(v_candidate->>'allocation_key', ''));
    v_fingerprint := btrim(coalesce(v_candidate->>'order_fingerprint', ''));
    v_slot := coalesce((v_candidate->>'quantity_slot')::integer, 1);
    v_mall := coalesce(v_candidate->>'mall_name', '');
    v_order_no := coalesce(v_candidate->>'customer_order_no', '');
    v_ordered_at := nullif(v_candidate->>'ordered_at', '')::timestamp;
    v_file := coalesce(v_candidate->>'source_file_name', '');

    if v_map_id is null or v_style_id is null or v_key = '' or v_fingerprint = '' then
      raise exception 'map_id, style_id, allocation_key, order_fingerprint가 필요합니다.';
    end if;

    if not exists (
      select 1
      from public.invoice_gift_source_maps m
      where m.brand_id = p_brand_id
        and m.id = v_map_id
        and m.is_active
    ) then
      raise exception '활성 사은품 원본행 매핑을 찾지 못했습니다.';
    end if;

    select a.style_id
    into v_existing
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.allocation_key = v_key
    limit 1;

    if v_existing is not null then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'allocation_key', v_key,
        'style_id', v_existing,
        'reused', true
      ));
      continue;
    end if;

    select exists (
      select 1
      from public.invoice_gift_source_map_products p
      where p.brand_id = p_brand_id
        and p.map_id = v_map_id
        and p.style_id = v_style_id
    )
    into v_in_pool;
    if not v_in_pool then
      raise exception '후보 풀에 없는 M번호는 확정할 수 없습니다.';
    end if;

    insert into public.invoice_gift_source_allocations (
      brand_id,
      map_id,
      style_id,
      allocation_key,
      order_fingerprint,
      quantity_slot,
      mall_name,
      customer_order_no,
      ordered_at,
      source_file_name
    )
    values (
      p_brand_id,
      v_map_id,
      v_style_id,
      v_key,
      v_fingerprint,
      v_slot,
      v_mall,
      v_order_no,
      v_ordered_at,
      v_file
    );

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'allocation_key', v_key,
      'style_id', v_style_id,
      'reused', false
    ));
  end loop;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_warehouse_inventory_set(p_brand_id uuid, p_set_id uuid)
 RETURNS warehouse_inventory_sets
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_set public.warehouse_inventory_sets;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '창고 연습 데이터를 복원할 권한이 없습니다.';
  end if;

  select *
    into v_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and id = p_set_id;
  if v_set.id is null then
    raise exception '복원할 연습 세트를 찾지 못했습니다.';
  end if;
  if v_set.kind <> 'sandbox' then
    raise exception '연습 세트만 복원할 수 있습니다.';
  end if;
  if v_set.status = 'active' then
    return v_set;
  end if;

  update public.warehouse_inventory_sets
  set status = 'archived'
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
    and id <> p_set_id;

  update public.warehouse_inventory_sets
  set status = 'active'
  where brand_id = p_brand_id
    and id = p_set_id
  returning * into v_set;

  insert into public.warehouse_stock_movements (
    brand_id, set_id, action, box_count, reason, actor_id
  )
  values (
    p_brand_id, v_set.id, 'import', v_set.row_count,
    '이전 연습 세트 복원', auth.uid()
  );

  return v_set;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.import_warehouse_inventory_set(p_brand_id uuid, p_source_file_name text, p_rows jsonb)
 RETURNS warehouse_inventory_sets
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid;
  v_warehouse_id uuid;
  v_previous_set public.warehouse_inventory_sets;
  v_set public.warehouse_inventory_sets;
  v_zone text;
  v_zone_count integer;
  v_row_count integer;
begin
  perform set_config('statement_timeout', '60s', true);
  if p_brand_id is null then raise exception '브랜드를 지정하세요.'; end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then raise exception '창고 연습 데이터를 가져올 권한이 없습니다.'; end if;
  if p_source_file_name is null or btrim(p_source_file_name) = '' then raise exception '원본 파일 이름을 입력하세요.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception '가져올 창고 행이 없습니다.'; end if;
  select count(distinct coalesce(nullif(btrim(item ->> 'zone'), ''), 'box_storage')), min(coalesce(nullif(btrim(item ->> 'zone'), ''), 'box_storage')) into v_zone_count, v_zone from jsonb_array_elements(p_rows) as item;
  if v_zone_count <> 1 or v_zone not in ('box_storage', 'picking') then raise exception '한 번에 한 창고 구역의 행만 가져올 수 있습니다.'; end if;
  select brand.company_id into v_company_id from public.brands as brand where brand.id = p_brand_id;
  if v_company_id is null then raise exception '브랜드를 찾을 수 없습니다.'; end if;
  select * into v_previous_set from public.warehouse_inventory_sets where brand_id = p_brand_id and kind = 'sandbox' and status = 'active' limit 1 for update;
  if v_previous_set.id is null then
    insert into public.warehouses (company_id, name) values (v_company_id, '연습 창고') on conflict (company_id, name) do update set name = excluded.name returning id into v_warehouse_id;
  else
    v_warehouse_id := v_previous_set.warehouse_id;
    update public.warehouse_inventory_sets set status = 'archived' where id = v_previous_set.id;
  end if;
  insert into public.warehouse_inventory_sets (brand_id, warehouse_id, kind, status, source_file_name, row_count, imported_by)
  values (p_brand_id, v_warehouse_id, 'sandbox', 'active', btrim(p_source_file_name), 0, auth.uid())
  returning * into v_set;
  if v_previous_set.id is not null then
    insert into public.warehouse_stock_positions (brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location, usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw, remaining_boxes_raw, opened_units, review_flags, source_row_number, note, external_row_id)
    select pos.brand_id, v_set.id, pos.warehouse_id, pos.location_id, pos.style_id, pos.source_style_no, pos.normalized_style_no, pos.source_product_name, pos.received_on, pos.received_on_raw, pos.is_forced_priority, pos.is_final_location, pos.usage_priority, pos.quantity_status, pos.units_per_box, pos.remaining_boxes, pos.units_per_box_raw, pos.remaining_boxes_raw, pos.opened_units, pos.review_flags, pos.source_row_number, pos.note, pos.external_row_id
    from public.warehouse_stock_positions as pos join public.warehouse_locations as loc on loc.id = pos.location_id
    where pos.brand_id = p_brand_id and pos.set_id = v_previous_set.id and loc.zone <> v_zone;
    insert into public.warehouse_boxes (brand_id, set_id, display_code, location_id, style_id, received_on, initial_qty, current_qty, status)
    select stock_box.brand_id, v_set.id, stock_box.display_code, stock_box.location_id, stock_box.style_id, stock_box.received_on, stock_box.initial_qty, stock_box.current_qty, stock_box.status
    from public.warehouse_boxes as stock_box join public.warehouse_locations as loc on loc.id = stock_box.location_id
    where stock_box.brand_id = p_brand_id and stock_box.set_id = v_previous_set.id and loc.zone <> v_zone;
  end if;
  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  select distinct v_company_id, v_warehouse_id, coalesce(nullif(btrim(item ->> 'location_code'), ''), '(빈 자리)'), v_zone
  from jsonb_array_elements(p_rows) as item on conflict (warehouse_id, zone, code) do nothing;
  insert into public.warehouse_stock_positions (brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location, usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw, remaining_boxes_raw, opened_units, review_flags, source_row_number, note, external_row_id)
  select p_brand_id, v_set.id, v_warehouse_id, loc.id, nullif(parsed.item ->> 'style_id', '')::uuid, coalesce(parsed.item ->> 'source_style_no', ''), coalesce(parsed.item ->> 'normalized_style_no', ''), coalesce(parsed.item ->> 'source_product_name', ''), nullif(parsed.item ->> 'received_on', '')::date, coalesce(parsed.item ->> 'received_on_raw', ''), coalesce((parsed.item ->> 'is_forced_priority')::boolean, false), coalesce((parsed.item ->> 'is_final_location')::boolean, false), coalesce(nullif(parsed.item ->> 'usage_priority', ''), case when coalesce((parsed.item ->> 'is_forced_priority')::boolean, false) or coalesce(parsed.item ->> 'received_on_raw', '') in ('', '000000') then 'first' when coalesce(parsed.item ->> 'received_on_raw', '') = '000001' then 'second' when coalesce(parsed.item ->> 'received_on_raw', '') = '999999' then 'last' else 'fifo' end), parsed.quantity_status, parsed.units_per_box, parsed.remaining_boxes, coalesce(parsed.item ->> 'units_per_box_raw', coalesce(parsed.item ->> 'units_per_box', '')), coalesce(parsed.item ->> 'remaining_boxes_raw', coalesce(parsed.item ->> 'remaining_boxes', '')), 0, coalesce(array(select jsonb_array_elements_text(coalesce(parsed.item -> 'review_flags', '[]'::jsonb))), '{}'::text[]), (parsed.item ->> 'source_row_number')::integer, coalesce(parsed.item ->> 'note', ''), nullif(btrim(coalesce(parsed.item ->> 'external_row_id', '')), '')
  from (select item, case when nullif(item ->> 'units_per_box', '') is null then null when (item ->> 'units_per_box')::integer < 1 then null else (item ->> 'units_per_box')::integer end as units_per_box, case when nullif(item ->> 'remaining_boxes', '') is null then null when (item ->> 'remaining_boxes')::integer < 0 then null else (item ->> 'remaining_boxes')::integer end as remaining_boxes, case when coalesce(item ->> 'quantity_status', '') = 'unknown' then 'unknown' when nullif(item ->> 'units_per_box', '') is null or nullif(item ->> 'remaining_boxes', '') is null or coalesce((item ->> 'units_per_box')::integer, 0) < 1 then 'unknown' else 'known' end as quantity_status from jsonb_array_elements(p_rows) as item) as parsed
  join public.warehouse_locations as loc on loc.warehouse_id = v_warehouse_id and loc.zone = v_zone and loc.code = coalesce(nullif(btrim(parsed.item ->> 'location_code'), ''), '(빈 자리)');
  if v_zone = 'picking' then
    insert into public.warehouse_registered_slots (warehouse_id, code, zone)
    select distinct v_warehouse_id, coalesce(nullif(btrim(item ->> 'location_code'), ''), '(빈 자리)'), 'picking' from jsonb_array_elements(p_rows) as item on conflict (warehouse_id, code) do update set zone = 'picking';
  end if;
  select count(*)::integer into v_row_count from public.warehouse_stock_positions where brand_id = p_brand_id and set_id = v_set.id;
  update public.warehouse_inventory_sets set row_count = v_row_count where id = v_set.id returning * into v_set;
  insert into public.warehouse_stock_movements (brand_id, set_id, action, box_count, reason, actor_id) values (p_brand_id, v_set.id, 'import', jsonb_array_length(p_rows), case when v_zone = 'picking' then '출고창고 엑셀 교체' else '박스창고 엑셀 교체' end, auth.uid());
  return v_set;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_warehouse_stock_action(p_brand_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_set public.warehouse_inventory_sets;
  v_company_id uuid;
  v_position public.warehouse_stock_positions;
  v_target public.warehouse_stock_positions;
  v_location public.warehouse_locations;
  v_to_location_id uuid;
  v_to_code text;
  v_to_zone text;
  v_box_count integer;
  v_remaining integer;
  v_opened integer;
  v_units integer;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then raise exception '창고 연습 데이터를 수정할 권한이 없습니다.'; end if;
  if p_action not in ('receive', 'move', 'deplete', 'adjust', 'replenish', 'open') then raise exception '지원하지 않는 창고 작업입니다.'; end if;
  select * into v_set from public.warehouse_inventory_sets where brand_id = p_brand_id and kind = 'sandbox' and status = 'active' limit 1;
  if v_set.id is null then raise exception '활성 연습 데이터가 없습니다. 엑셀을 먼저 가져오세요.'; end if;
  select brand.company_id into v_company_id from public.brands as brand where brand.id = p_brand_id;
  if p_action = 'receive' then
    v_to_code := btrim(p_payload ->> 'location_code');
    v_to_zone := coalesce(nullif(btrim(p_payload ->> 'zone'), ''), 'box_storage');
    v_box_count := (p_payload ->> 'remaining_boxes')::integer;
    v_units := (p_payload ->> 'units_per_box')::integer;
    if v_to_code = '' or v_box_count is null or v_box_count < 1 or v_units is null or v_units < 1 then raise exception '자리번호·입수·박스 수를 확인하세요.'; end if;
    insert into public.warehouse_locations (company_id, warehouse_id, code, zone) values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone) on conflict (warehouse_id, zone, code) do update set code = excluded.code returning id into v_to_location_id;
    perform public.touch_warehouse_registered_slot(v_set.warehouse_id, v_to_code, v_to_zone);
    insert into public.warehouse_stock_positions (brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location, usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw, remaining_boxes_raw, review_flags, source_row_number, note)
    values (p_brand_id, v_set.id, v_set.warehouse_id, v_to_location_id, nullif(p_payload ->> 'style_id', '')::uuid, coalesce(p_payload ->> 'source_style_no', ''), coalesce(p_payload ->> 'normalized_style_no', p_payload ->> 'source_style_no'), coalesce(p_payload ->> 'source_product_name', ''), nullif(p_payload ->> 'received_on', '')::date, coalesce(p_payload ->> 'received_on_raw', p_payload ->> 'received_on', ''), coalesce((p_payload ->> 'is_forced_priority')::boolean, false), coalesce((p_payload ->> 'is_final_location')::boolean, false), coalesce(nullif(p_payload ->> 'usage_priority', ''), case when coalesce((p_payload ->> 'is_forced_priority')::boolean, false) then 'first' when coalesce(p_payload ->> 'received_on_raw', '') = '000001' then 'second' when coalesce(p_payload ->> 'received_on_raw', '') = '999999' then 'last' else 'fifo' end), 'known', v_units, v_box_count, v_units::text, v_box_count::text, case when nullif(p_payload ->> 'style_id', '') is null then array['missing_style']::text[] else '{}'::text[] end, 900000 + (extract(epoch from now())::integer % 100000), coalesce(p_payload ->> 'note', '')) returning * into v_position;
    insert into public.warehouse_stock_movements (brand_id, set_id, action, position_id, style_id, to_location_code, box_count, unit_count, reason, actor_id) values (p_brand_id, v_set.id, 'receive', v_position.id, v_position.style_id, v_to_code, v_box_count, v_box_count * v_units, coalesce(p_payload ->> 'reason', '신규 입고'), auth.uid());
    return to_jsonb(v_position);
  end if;
  select * into v_position from public.warehouse_stock_positions where brand_id = p_brand_id and set_id = v_set.id and id = (p_payload ->> 'position_id')::uuid;
  if v_position.id is null then raise exception '창고 자리를 찾지 못했습니다.'; end if;
  select * into v_location from public.warehouse_locations where id = v_position.location_id;
  if p_action = 'adjust' then
    v_remaining := (p_payload ->> 'remaining_boxes')::integer;
    v_opened := coalesce((p_payload ->> 'opened_units')::integer, v_position.opened_units);
    v_units := coalesce((p_payload ->> 'units_per_box')::integer, v_position.units_per_box);
    if v_remaining is null or v_remaining < 0 or v_opened < 0 or v_units is null or v_units < 1 then raise exception '입수와 잔여 수량을 확인하세요.'; end if;
    update public.warehouse_stock_positions set remaining_boxes = v_remaining, opened_units = v_opened, units_per_box = v_units, quantity_status = 'known', units_per_box_raw = v_units::text, remaining_boxes_raw = v_remaining::text where id = v_position.id returning * into v_position;
    insert into public.warehouse_stock_movements (brand_id, set_id, action, position_id, style_id, from_location_code, box_count, unit_count, reason, actor_id) values (p_brand_id, v_set.id, 'adjust', v_position.id, v_position.style_id, v_location.code, v_remaining, v_opened, coalesce(p_payload ->> 'reason', '실사 수정'), auth.uid());
    return to_jsonb(v_position);
  end if;
  if v_position.quantity_status = 'unknown' or v_position.units_per_box is null or v_position.remaining_boxes is null then raise exception '수량 미확인 행은 수량 작업을 할 수 없습니다.'; end if;
  if p_action = 'deplete' then
    v_box_count := v_position.remaining_boxes; v_opened := v_position.opened_units;
    update public.warehouse_stock_positions set remaining_boxes = 0, opened_units = 0, remaining_boxes_raw = '0' where id = v_position.id returning * into v_position;
    insert into public.warehouse_stock_movements (brand_id, set_id, action, position_id, style_id, from_location_code, box_count, unit_count, reason, actor_id) values (p_brand_id, v_set.id, 'deplete', v_position.id, v_position.style_id, v_location.code, v_box_count, v_opened, coalesce(p_payload ->> 'reason', '자리 소진'), auth.uid());
    return to_jsonb(v_position);
  end if;
  if p_action = 'open' then
    if v_location.zone <> 'picking' then raise exception '개봉은 출고창고에서만 할 수 있습니다. 먼저 박스를 충원하세요.'; end if;
    v_box_count := (p_payload ->> 'box_count')::integer;
    if v_box_count is null or v_box_count < 1 then raise exception '개봉할 박스 수를 입력하세요.'; end if;
    if v_box_count > v_position.remaining_boxes then raise exception '남은 박스보다 많이 개봉할 수 없습니다.'; end if;
    update public.warehouse_stock_positions set remaining_boxes = remaining_boxes - v_box_count, opened_units = opened_units + v_box_count * units_per_box, remaining_boxes_raw = (remaining_boxes - v_box_count)::text where id = v_position.id returning * into v_position;
    insert into public.warehouse_stock_movements (brand_id, set_id, action, position_id, style_id, from_location_code, to_location_code, box_count, unit_count, reason, actor_id) values (p_brand_id, v_set.id, 'open', v_position.id, v_position.style_id, v_location.code, v_location.code, v_box_count, v_box_count * v_position.units_per_box, coalesce(p_payload ->> 'reason', '박스 개봉'), auth.uid());
    return to_jsonb(v_position);
  end if;
  v_to_code := btrim(coalesce(p_payload ->> 'to_location_code', ''));
  v_to_zone := coalesce(nullif(btrim(p_payload ->> 'to_zone'), ''), case when p_action = 'replenish' then 'picking' else v_location.zone end);
  v_box_count := coalesce((p_payload ->> 'box_count')::integer, v_position.remaining_boxes);
  if v_to_code = '' then raise exception '옮길 자리번호를 입력하세요.'; end if;
  if v_box_count < 1 then raise exception '옮길 박스 수는 1 이상이어야 합니다.'; end if;
  if v_box_count > v_position.remaining_boxes then raise exception '남은 박스보다 많이 옮길 수 없습니다.'; end if;
  if p_action = 'move' and v_location.zone = 'box_storage' and v_to_zone <> 'box_storage' then raise exception '박스창고에서는 박스 단위 자리 이동만 할 수 있습니다. 출고 충원은 충원 작업을 쓰세요.'; end if;
  insert into public.warehouse_locations (company_id, warehouse_id, code, zone) values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone) on conflict (warehouse_id, zone, code) do update set code = excluded.code returning id into v_to_location_id;
  perform public.touch_warehouse_registered_slot(v_set.warehouse_id, v_to_code, v_to_zone);
  if v_box_count = v_position.remaining_boxes then
    update public.warehouse_stock_positions set location_id = v_to_location_id where id = v_position.id returning * into v_position;
  else
    update public.warehouse_stock_positions set remaining_boxes = remaining_boxes - v_box_count, remaining_boxes_raw = (remaining_boxes - v_box_count)::text where id = v_position.id returning * into v_position;
    insert into public.warehouse_stock_positions (brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location, usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw, remaining_boxes_raw, review_flags, source_row_number, note)
    values (v_position.brand_id, v_position.set_id, v_position.warehouse_id, v_to_location_id, v_position.style_id, v_position.source_style_no, v_position.normalized_style_no, v_position.source_product_name, v_position.received_on, v_position.received_on_raw, v_position.is_forced_priority, v_position.is_final_location, v_position.usage_priority, v_position.quantity_status, v_position.units_per_box, v_box_count, v_position.units_per_box_raw, v_box_count::text, v_position.review_flags, v_position.source_row_number, v_position.note) returning * into v_target;
  end if;
  insert into public.warehouse_stock_movements (brand_id, set_id, action, position_id, style_id, from_location_code, to_location_code, box_count, unit_count, reason, actor_id)
  values (p_brand_id, v_set.id, p_action, coalesce(v_target.id, v_position.id), v_position.style_id, v_location.code, v_to_code, v_box_count, v_box_count * v_position.units_per_box, coalesce(p_payload ->> 'reason', case when p_action = 'replenish' then '출고창고 박스 충원' else '자리 이동' end), auth.uid());
  return jsonb_build_object('source', to_jsonb(v_position), 'moved', to_jsonb(v_target));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_outbound_partner_alias(p_brand_id uuid, p_target_id uuid, p_alias text, p_normalized_alias text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_target public.code_usage_targets%rowtype;
  v_alias text;
  v_key text;
  v_existing uuid;
begin
  if p_brand_id is null or p_target_id is null then
    raise exception 'brand_id와 target_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  v_alias := btrim(coalesce(p_alias, ''));
  v_key := coalesce(p_normalized_alias, '');
  if v_alias = '' then
    raise exception '연결할 이름을 입력하세요.';
  end if;
  if v_key = '' then
    raise exception '이름에 글자나 숫자가 있어야 합니다.';
  end if;

  select *
    into v_target
    from public.code_usage_targets
   where brand_id = p_brand_id
     and id = p_target_id
     for update;

  if not found then
    raise exception '업체를 찾을 수 없습니다.';
  end if;

  if not v_target.active then
    raise exception '비활성 업체에는 연결할 수 없습니다. 출고업체에서 다시 켜세요.';
  end if;

  if v_target.normalized_name = v_key then
    return v_target.id;
  end if;

  if exists (
    select 1
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id <> p_target_id
       and t.normalized_name = v_key
  ) then
    raise exception '이미 다른 업체의 정식명입니다.';
  end if;

  select id
    into v_existing
    from public.code_usage_target_aliases
   where brand_id = p_brand_id
     and target_id = p_target_id
     and normalized_alias = v_key;

  if v_existing is not null then
    return v_existing;
  end if;

  if exists (
    select 1
      from public.code_usage_target_aliases a
     where a.brand_id = p_brand_id
       and a.target_id <> p_target_id
       and a.normalized_alias = v_key
  ) then
    raise exception '이미 다른 업체에 등록된 별칭입니다.';
  end if;

  insert into public.code_usage_target_aliases (
    brand_id,
    target_id,
    alias,
    normalized_alias
  )
  values (
    p_brand_id,
    p_target_id,
    v_alias,
    v_key
  )
  returning id into v_existing;

  return v_existing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_outbound_partner_with_aliases(p_brand_id uuid, p_id uuid, p_name text, p_normalized_name text, p_channel_type text, p_shipping_method text, p_is_one_time boolean, p_active boolean, p_note text, p_folder_id uuid, p_aliases jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_next_order integer;
  v_alias jsonb;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception '업체 이름을 입력하세요.';
  end if;

  if length(coalesce(p_normalized_name, '')) = 0 then
    raise exception '업체 이름에 글자나 숫자가 있어야 합니다.';
  end if;

  if p_folder_id is not null then
    if not exists (
      select 1
        from public.code_usage_target_folders
       where id = p_folder_id
         and brand_id = p_brand_id
    ) then
      raise exception '분류 폴더를 찾을 수 없습니다.';
    end if;
  end if;

  if p_id is null then
    select coalesce(max(sort_order) + 1, 0)
      into v_next_order
      from public.code_usage_targets
     where brand_id = p_brand_id;

    insert into public.code_usage_targets (
      brand_id,
      name,
      normalized_name,
      channel_type,
      shipping_method,
      is_one_time,
      active,
      note,
      folder_id,
      sort_order
    )
    values (
      p_brand_id,
      p_name,
      p_normalized_name,
      coalesce(p_channel_type, 'unset'),
      coalesce(p_shipping_method, 'unset'),
      coalesce(p_is_one_time, false),
      coalesce(p_active, true),
      coalesce(p_note, ''),
      p_folder_id,
      v_next_order
    )
    returning id into v_id;
  else
    update public.code_usage_targets
       set name = p_name,
           normalized_name = p_normalized_name,
           channel_type = coalesce(p_channel_type, channel_type),
           shipping_method = coalesce(p_shipping_method, shipping_method),
           is_one_time = coalesce(p_is_one_time, is_one_time),
           active = coalesce(p_active, active),
           note = coalesce(p_note, note),
           folder_id = p_folder_id
     where id = p_id
       and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '업체를 찾을 수 없습니다.';
    end if;
  end if;

  delete from public.code_usage_target_aliases
   where brand_id = p_brand_id
     and target_id = v_id;

  if p_aliases is not null and jsonb_typeof(p_aliases) = 'array' then
    for v_alias in select * from jsonb_array_elements(p_aliases)
    loop
      if length(btrim(coalesce(v_alias ->> 'alias', ''))) = 0 then
        continue;
      end if;
      if length(coalesce(v_alias ->> 'normalized_alias', '')) = 0 then
        continue;
      end if;

      insert into public.code_usage_target_aliases (
        brand_id,
        target_id,
        alias,
        normalized_alias,
        note
      )
      values (
        p_brand_id,
        v_id,
        v_alias ->> 'alias',
        v_alias ->> 'normalized_alias',
        coalesce(v_alias ->> 'note', '')
      );
    end loop;
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_barcode_partner_display_targets(p_brand_id uuid, p_display_scope text, p_usage_target_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_setting_id uuid;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_display_scope not in ('own', 'partner') then
    raise exception '올바르지 않은 업체 표시 범위입니다.';
  end if;

  insert into public.barcode_partner_display_settings (
    brand_id,
    display_scope
  ) values (
    p_brand_id,
    p_display_scope
  )
  on conflict (brand_id, display_scope)
  do update set updated_at = now()
  returning id into v_setting_id;

  delete from public.barcode_partner_display_targets
  where brand_id = p_brand_id
    and setting_id = v_setting_id;

  insert into public.barcode_partner_display_targets (
    brand_id,
    setting_id,
    usage_target_id
  )
  select
    p_brand_id,
    v_setting_id,
    target_id
  from (
    select distinct unnest(coalesce(p_usage_target_ids, '{}'::uuid[])) as target_id
  ) selected;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_invoice_work_completion(p_brand_id uuid, p_file_fingerprint text, p_source_file_name text, p_worker_label text, p_source_row_count integer, p_source_order_count integer, p_exported_row_count integer, p_review_row_count integer, p_sites jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_run_id uuid;
  v_site jsonb;
  v_target_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_target_ids uuid[] := array[]::uuid[];
  v_locked integer;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 출고 이력을 저장할 권한이 없습니다.';
  end if;
  if length(btrim(coalesce(p_file_fingerprint, ''))) = 0 then
    raise exception '파일 지문이 필요합니다.';
  end if;
  if p_sites is null or jsonb_typeof(p_sites) <> 'array' then
    raise exception '사이트 집계 목록이 필요합니다.';
  end if;
  if coalesce(p_source_row_count, 0) < 0
     or coalesce(p_source_order_count, 0) < 0
     or coalesce(p_exported_row_count, 0) < 0
     or coalesce(p_review_row_count, 0) < 0 then
    raise exception '집계 수치는 0 이상이어야 합니다.';
  end if;

  for v_site in
    select value from jsonb_array_elements(p_sites)
  loop
    v_target_id := (v_site->>'usage_target_id')::uuid;
    if v_target_id is null then
      raise exception 'usage_target_id가 필요합니다.';
    end if;
    if v_target_id = any (v_seen) then
      raise exception '같은 사이트가 두 번 들어 있습니다.';
    end if;
    if coalesce((v_site->>'order_count')::integer, 0) < 0
       or coalesce((v_site->>'source_row_count')::integer, 0) < 0
       or coalesce((v_site->>'source_quantity')::integer, 0) < 0
       or coalesce((v_site->>'cj_order_row_count')::integer, 0) < 0
       or coalesce((v_site->>'cj_order_quantity')::integer, 0) < 0
       or coalesce((v_site->>'cj_gift_row_count')::integer, 0) < 0
       or coalesce((v_site->>'cj_gift_quantity')::integer, 0) < 0 then
      raise exception '사이트 집계 수치는 0 이상이어야 합니다.';
    end if;
    v_seen := array_append(v_seen, v_target_id);
    v_target_ids := array_append(v_target_ids, v_target_id);
  end loop;

  if coalesce(array_length(v_target_ids, 1), 0) > 0 then
    select count(*)
      into v_locked
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids);

    if v_locked <> coalesce(array_length(v_target_ids, 1), 0) then
      raise exception '같은 브랜드의 출고업체만 집계할 수 있습니다.';
    end if;

    perform 1
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids)
     order by t.id
       for update;
  end if;

  perform 1
    from public.invoice_work_runs r
   where r.brand_id = p_brand_id
     and r.file_fingerprint = btrim(p_file_fingerprint)
     for update;

  insert into public.invoice_work_runs (
    brand_id,
    file_fingerprint,
    source_file_name,
    completed_by,
    worker_label,
    completed_at,
    source_row_count,
    source_order_count,
    exported_row_count,
    review_row_count
  )
  values (
    p_brand_id,
    btrim(p_file_fingerprint),
    coalesce(p_source_file_name, ''),
    auth.uid(),
    coalesce(p_worker_label, ''),
    now(),
    coalesce(p_source_row_count, 0),
    coalesce(p_source_order_count, 0),
    coalesce(p_exported_row_count, 0),
    coalesce(p_review_row_count, 0)
  )
  on conflict (brand_id, file_fingerprint)
  do update set
    source_file_name = excluded.source_file_name,
    completed_by = excluded.completed_by,
    worker_label = excluded.worker_label,
    completed_at = excluded.completed_at,
    source_row_count = excluded.source_row_count,
    source_order_count = excluded.source_order_count,
    exported_row_count = excluded.exported_row_count,
    review_row_count = excluded.review_row_count
  returning id into v_run_id;

  delete from public.invoice_work_site_summaries
   where brand_id = p_brand_id
     and run_id = v_run_id;

  for v_site in
    select value
      from jsonb_array_elements(p_sites)
     order by value->>'usage_target_id'
  loop
    insert into public.invoice_work_site_summaries (
      brand_id,
      run_id,
      usage_target_id,
      source_mall_names,
      order_count,
      source_row_count,
      source_quantity,
      cj_order_row_count,
      cj_order_quantity,
      cj_gift_row_count,
      cj_gift_quantity
    )
    values (
      p_brand_id,
      v_run_id,
      (v_site->>'usage_target_id')::uuid,
      coalesce(v_site->>'source_mall_names', ''),
      coalesce((v_site->>'order_count')::integer, 0),
      coalesce((v_site->>'source_row_count')::integer, 0),
      coalesce((v_site->>'source_quantity')::integer, 0),
      coalesce((v_site->>'cj_order_row_count')::integer, 0),
      coalesce((v_site->>'cj_order_quantity')::integer, 0),
      coalesce((v_site->>'cj_gift_row_count')::integer, 0),
      coalesce((v_site->>'cj_gift_quantity')::integer, 0)
    );
  end loop;

  return v_run_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_product_code_with_components(p_brand_id uuid, p_id uuid, p_kind text, p_code text, p_name text, p_weight_g integer, p_width_cm numeric, p_depth_cm numeric, p_height_cm numeric, p_note text, p_values jsonb, p_components jsonb, p_usage_target_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  v_usage_target_id uuid;
  comp jsonb;
  i integer := 0;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_kind not in ('own', 'partner') then
    raise exception '코드 종류가 올바르지 않습니다.';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception '코드명을 입력하세요.';
  end if;
  if nullif(trim(p_code), '') is null then
    raise exception '코드값을 입력하세요.';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception '추가 항목 형식이 올바르지 않습니다.';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' then
    raise exception '구성품 형식이 올바르지 않습니다.';
  end if;

  if p_kind = 'own' then
    v_usage_target_id := null;
  else
    v_usage_target_id := p_usage_target_id;
    if v_usage_target_id is null and p_id is not null then
      select usage_target_id
        into v_usage_target_id
      from public.product_codes
      where id = p_id and brand_id = p_brand_id;
    end if;
    if v_usage_target_id is null then
      raise exception '거래처 코드는 업체가 필요합니다.';
    end if;
  end if;

  if p_id is null then
    insert into public.product_codes (
      brand_id, kind, usage_target_id, code, name, weight_g, width_cm, depth_cm, height_cm,
      note, values
    ) values (
      p_brand_id, p_kind, v_usage_target_id, trim(p_code), trim(p_name),
      p_weight_g, p_width_cm, p_depth_cm, p_height_cm,
      coalesce(p_note, ''), p_values
    )
    returning id into v_id;
  else
    update public.product_codes
    set kind = p_kind,
        usage_target_id = v_usage_target_id,
        code = trim(p_code),
        name = trim(p_name),
        weight_g = p_weight_g,
        width_cm = p_width_cm,
        depth_cm = p_depth_cm,
        height_cm = p_height_cm,
        note = coalesce(p_note, ''),
        values = p_values,
        updated_at = now()
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '코드를 찾을 수 없습니다.';
    end if;

    delete from public.product_code_components where product_code_id = v_id;
  end if;

  for comp in select * from jsonb_array_elements(p_components)
  loop
    i := i + 1;
    insert into public.product_code_components (
      brand_id, product_code_id, style_id, style_no, qty, sort_order
    ) values (
      p_brand_id,
      v_id,
      (comp->>'styleId')::uuid,
      coalesce(comp->>'styleNo', ''),
      greatest(1, coalesce((comp->>'qty')::int, 1)),
      i
    );
  end loop;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_bulk_outbound_backup(p_brand_id uuid, p_job_id uuid, p_usage_target_id uuid, p_shipped_on date, p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  item jsonb;
  v_style_id uuid;
  v_qty integer;
  v_note text;
  v_count integer := 0;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.bulk_outbound_jobs
    where id = p_job_id and brand_id = p_brand_id
  ) then
    raise exception '작업을 찾을 수 없습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;

  v_note := 'bulk-backup:' || p_job_id::text;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = p_job_id::text;

  for item in select * from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        v_style_id := null;
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null or v_qty <= 0 then
      continue;
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      continue;
    end if;

    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      v_style_id,
      p_usage_target_id,
      coalesce(p_shipped_on, (timezone('Asia/Seoul', now()))::date),
      v_qty,
      'bulk',
      p_job_id::text,
      v_note
    )
    on conflict (
      brand_id, source, source_ref, style_id, usage_target_id, shipped_on
    )
    do update set
      quantity = excluded.quantity,
      note = excluded.note,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.initialize_bulk_outbound_template_fields(p_brand_id uuid, p_usage_target_id uuid, p_barcode_source text, p_fields jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_brand_id::text || ':bulk-template:' ||
      p_usage_target_id::text || ':' || coalesce(p_barcode_source, ''),
      0
    )
  );

  if exists (
    select 1
    from public.bulk_outbound_template_fields
    where brand_id = p_brand_id
      and usage_target_id = p_usage_target_id
      and barcode_source = p_barcode_source
  ) then
    return false;
  end if;

  perform public.replace_bulk_outbound_template_fields(
    p_brand_id,
    p_usage_target_id,
    p_barcode_source,
    p_fields
  );
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_bulk_outbound_job(p_brand_id uuid, p_id uuid, p_usage_target_id uuid, p_title text, p_status text, p_barcode_source text, p_started_on date, p_due_on date, p_assignee text, p_note text, p_planned_qty integer, p_lines jsonb, p_files jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  item jsonb;
  v_file_id uuid;
  i integer := 0;
  v_extra jsonb;
  v_clean jsonb;
  v_key text;
  v_val text;
  v_extra_count integer;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception '작업 제목을 입력하세요.';
  end if;
  if p_status not in ('draft', 'converting', 'backup', 'docs', 'done') then
    raise exception '작업 상태가 올바르지 않습니다.';
  end if;
  if p_barcode_source not in ('own', 'partner') then
    raise exception '바코드 출처가 올바르지 않습니다.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '작업 행 형식이 올바르지 않습니다.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception '파일 메타 형식이 올바르지 않습니다.';
  end if;

  if p_id is null then
    insert into public.bulk_outbound_jobs (
      brand_id, usage_target_id, title, status, barcode_source,
      started_on, due_on, assignee, note, planned_qty
    ) values (
      p_brand_id,
      p_usage_target_id,
      btrim(p_title),
      p_status,
      p_barcode_source,
      coalesce(p_started_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_due_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_assignee, ''),
      coalesce(p_note, ''),
      greatest(0, coalesce(p_planned_qty, 0))
    )
    returning id into v_id;
  else
    update public.bulk_outbound_jobs
    set usage_target_id = p_usage_target_id,
        title = btrim(p_title),
        status = p_status,
        barcode_source = p_barcode_source,
        started_on = coalesce(p_started_on, started_on),
        due_on = coalesce(p_due_on, due_on),
        assignee = coalesce(p_assignee, assignee),
        note = coalesce(p_note, note),
        planned_qty = greatest(0, coalesce(p_planned_qty, planned_qty)),
        updated_at = now()
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '작업을 찾을 수 없습니다.';
    end if;
  end if;

  delete from public.bulk_outbound_job_lines
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_lines)
  loop
    i := i + 1;
    v_extra := coalesce(item->'extraValues', '{}'::jsonb);
    if jsonb_typeof(v_extra) <> 'object' then
      v_extra := '{}'::jsonb;
    end if;

    v_clean := '{}'::jsonb;
    v_extra_count := 0;
    for v_key, v_val in select key, value from jsonb_each_text(v_extra)
    loop
      if v_extra_count >= 40 then
        exit;
      end if;
      if v_key ~* '(받는분|수령인|성명|전화번호|연락처|핸드폰|휴대폰|주소|배송메시지)' then
        continue;
      end if;
      if length(btrim(v_key)) not between 1 and 120 then
        continue;
      end if;
      v_clean := v_clean || jsonb_build_object(btrim(v_key), left(coalesce(v_val, ''), 500));
      v_extra_count := v_extra_count + 1;
    end loop;

    insert into public.bulk_outbound_job_lines (
      brand_id, job_id, barcode, order_qty, product_name, source_row_no, extra_values
    ) values (
      p_brand_id,
      v_id,
      coalesce(item->>'barcode', ''),
      greatest(0, coalesce((item->>'orderQty')::int, 0)),
      coalesce(item->>'productName', ''),
      coalesce((item->>'sourceRowNo')::int, i),
      v_clean
    );
  end loop;

  delete from public.bulk_outbound_job_files
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_files)
  loop
    v_file_id := null;
    begin
      v_file_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        v_file_id := null;
    end;
    insert into public.bulk_outbound_job_files (
      id, brand_id, job_id, file_name, file_size, kept_on
    ) values (
      coalesce(v_file_id, gen_random_uuid()),
      p_brand_id,
      v_id,
      btrim(coalesce(item->>'name', item->>'fileName', 'file')),
      greatest(0, coalesce((item->>'fileSize')::bigint, 0)),
      coalesce((item->>'keptOn')::date, (timezone('Asia/Seoul', now()))::date)
    );
  end loop;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_outbound_partner_identity_with_aliases(p_brand_id uuid, p_id uuid, p_name text, p_normalized_name text, p_channel_type text, p_shipping_method text, p_is_one_time boolean, p_active boolean, p_note text, p_folder_id uuid, p_group_id uuid, p_site_name text, p_normalized_site_name text, p_aliases jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_site_name text := btrim(coalesce(p_site_name, ''));
  v_normalized_site_name text := coalesce(p_normalized_site_name, '');
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  if p_group_id is not null and not exists (
    select 1
      from public.outbound_partner_groups
     where id = p_group_id
       and brand_id = p_brand_id
  ) then
    raise exception '업체 그룹을 찾을 수 없습니다.';
  end if;

  if length(v_site_name) > 0 and length(v_normalized_site_name) = 0 then
    raise exception '지점 이름에 글자나 숫자가 있어야 합니다.';
  end if;

  v_id := public.save_outbound_partner_with_aliases(
    p_brand_id,
    p_id,
    p_name,
    p_normalized_name,
    p_channel_type,
    p_shipping_method,
    p_is_one_time,
    p_active,
    p_note,
    p_folder_id,
    p_aliases
  );

  update public.code_usage_targets
     set group_id = p_group_id,
         site_name = v_site_name,
         normalized_site_name = v_normalized_site_name
   where id = v_id
     and brand_id = p_brand_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_outbound_partner_unit_with_aliases(p_brand_id uuid, p_id uuid, p_name text, p_normalized_name text, p_channel_type text, p_shipping_method text, p_is_one_time boolean, p_active boolean, p_note text, p_folder_id uuid, p_group_id uuid, p_site_name text, p_normalized_site_name text, p_contact_name text, p_contact_phone text, p_contact_email text, p_address text, p_aliases jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_contact_name text := btrim(coalesce(p_contact_name, ''));
  v_contact_phone text := btrim(coalesce(p_contact_phone, ''));
  v_contact_email text := btrim(coalesce(p_contact_email, ''));
  v_address text := btrim(coalesce(p_address, ''));
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  v_id := public.save_outbound_partner_identity_with_aliases(
    p_brand_id,
    p_id,
    p_name,
    p_normalized_name,
    p_channel_type,
    p_shipping_method,
    p_is_one_time,
    p_active,
    p_note,
    p_folder_id,
    p_group_id,
    p_site_name,
    p_normalized_site_name,
    p_aliases
  );

  update public.code_usage_targets
     set contact_name = v_contact_name,
         contact_phone = v_contact_phone,
         contact_email = v_contact_email,
         address = v_address
   where id = v_id
     and brand_id = p_brand_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_invoice_work_run(p_brand_id uuid, p_run_id uuid, p_source_file_name text, p_worker_label text, p_completed_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_locked integer;
begin
  if p_brand_id is null or p_run_id is null then
    raise exception '작업 이력이 올바르지 않습니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 출고 이력을 수정할 권한이 없습니다.';
  end if;
  if p_completed_at is null then
    raise exception '작업 시각을 확인하세요.';
  end if;

  update public.invoice_work_runs
     set source_file_name = coalesce(p_source_file_name, ''),
         worker_label = coalesce(p_worker_label, ''),
         completed_at = p_completed_at
   where brand_id = p_brand_id
     and id = p_run_id;

  get diagnostics v_locked = row_count;
  if v_locked = 0 then
    raise exception '작업 이력을 찾지 못했습니다.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_barcode_data_entry_shipments(p_brand_id uuid, p_source_ref text, p_shipped_on date, p_note text, p_usage_target_ids uuid[], p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  item jsonb;
  v_style_id uuid;
  v_target_id uuid;
  v_qty integer;
  v_count integer := 0;
  v_shipped_on date;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception '출고 출처가 올바르지 않습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;

  v_shipped_on := coalesce(p_shipped_on, (timezone('Asia/Seoul', now()))::date);

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and shipped_on = v_shipped_on
    and source_ref = p_source_ref;

  for item in select * from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        v_style_id := null;
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        v_target_id := null;
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null or v_target_id is null or v_qty <= 0 then
      continue;
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      continue;
    end if;
    if not exists (
      select 1
      from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      continue;
    end if;

    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      v_style_id,
      v_target_id,
      v_shipped_on,
      v_qty,
      'bulk',
      p_source_ref,
      coalesce(p_note, '')
    )
    on conflict (
      brand_id, source, source_ref, style_id, usage_target_id, shipped_on
    )
    do update set
      quantity = excluded.quantity,
      note = excluded.note,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_invoice_outbound_shipments(p_brand_id uuid, p_source_ref text, p_note text, p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  item jsonb;
  v_style_id uuid;
  v_target_id uuid;
  v_shipped_on date;
  v_qty integer;
  v_count integer := 0;
  v_source_ref text;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  v_source_ref := btrim(coalesce(p_source_ref, ''));
  if v_source_ref = '' then
    raise exception '출고 출처가 올바르지 않습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  for item in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '상품 정보가 올바르지 않습니다.';
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '출고업체 정보가 올바르지 않습니다.';
    end;
    begin
      v_shipped_on := (item->>'shippedOn')::date;
    exception
      when invalid_datetime_format then
        raise exception '주문일을 확인하세요.';
      when datetime_field_overflow then
        raise exception '주문일을 확인하세요.';
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null then
      raise exception '상품 정보가 올바르지 않습니다.';
    end if;
    if v_target_id is null then
      raise exception '출고업체 정보가 올바르지 않습니다.';
    end if;
    if v_shipped_on is null then
      raise exception '주문일을 확인하세요.';
    end if;
    if v_qty <= 0 then
      raise exception '출고 수량은 1 이상이어야 합니다.';
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 상품만 반영할 수 있습니다.';
    end if;
    if not exists (
      select 1
      from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 출고업체만 반영할 수 있습니다.';
    end if;

    v_key := v_style_id::text || '|' || v_target_id::text || '|' || v_shipped_on::text;
    if v_key = any (v_seen) then
      raise exception '같은 상품·업체·주문일이 두 번 들어 있습니다.';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  perform 1
    from public.outbound_shipments
   where brand_id = p_brand_id
     and source = 'invoice'
     and source_ref = v_source_ref
   for update;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'invoice'
    and source_ref = v_source_ref;

  for item in
    select value
      from jsonb_array_elements(p_entries)
     order by value->>'shippedOn', value->>'usageTargetId', value->>'styleId'
  loop
    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      (item->>'styleId')::uuid,
      (item->>'usageTargetId')::uuid,
      (item->>'shippedOn')::date,
      (item->>'quantity')::int,
      'invoice',
      v_source_ref,
      coalesce(p_note, '')
    )
    on conflict (
      brand_id, source, source_ref, style_id, usage_target_id, shipped_on
    )
    do update set
      quantity = excluded.quantity,
      note = excluded.note,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_invoice_work_backup(p_brand_id uuid, p_file_fingerprint text, p_source_file_name text, p_worker_label text, p_source_row_count integer, p_source_order_count integer, p_sites jsonb, p_order_key_hashes text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_run_id uuid;
  v_site jsonb;
  v_target_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_target_ids uuid[] := array[]::uuid[];
  v_locked integer;
  v_hash text;
  v_hash_seen text[] := array[]::text[];
  v_hashes text[] := coalesce(p_order_key_hashes, array[]::text[]);
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 출고 이력을 저장할 권한이 없습니다.';
  end if;
  if length(btrim(coalesce(p_file_fingerprint, ''))) = 0 then
    raise exception '파일 지문이 필요합니다.';
  end if;
  if p_sites is null or jsonb_typeof(p_sites) <> 'array' then
    raise exception '사이트 집계 목록이 필요합니다.';
  end if;
  if coalesce(p_source_row_count, 0) < 0
     or coalesce(p_source_order_count, 0) < 0 then
    raise exception '집계 수치는 0 이상이어야 합니다.';
  end if;

  foreach v_hash in array v_hashes
  loop
    if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
      raise exception '주문 키가 올바르지 않습니다.';
    end if;
    if v_hash = any (v_hash_seen) then
      raise exception '같은 주문 키가 두 번 들어 있습니다.';
    end if;
    v_hash_seen := array_append(v_hash_seen, v_hash);
  end loop;

  for v_site in
    select value from jsonb_array_elements(p_sites)
  loop
    v_target_id := (v_site->>'usage_target_id')::uuid;
    if v_target_id is null then
      raise exception 'usage_target_id가 필요합니다.';
    end if;
    if v_target_id = any (v_seen) then
      raise exception '같은 사이트가 두 번 들어 있습니다.';
    end if;
    if coalesce((v_site->>'order_count')::integer, 0) < 0
       or coalesce((v_site->>'source_row_count')::integer, 0) < 0
       or coalesce((v_site->>'source_quantity')::integer, 0) < 0 then
      raise exception '사이트 집계 수치는 0 이상이어야 합니다.';
    end if;
    v_seen := array_append(v_seen, v_target_id);
    v_target_ids := array_append(v_target_ids, v_target_id);
  end loop;

  if coalesce(array_length(v_target_ids, 1), 0) > 0 then
    select count(*)
      into v_locked
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids);

    if v_locked <> coalesce(array_length(v_target_ids, 1), 0) then
      raise exception '같은 브랜드의 출고업체만 집계할 수 있습니다.';
    end if;

    perform 1
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids)
     order by t.id
       for update;
  end if;

  perform 1
    from public.invoice_work_runs r
   where r.brand_id = p_brand_id
     and r.file_fingerprint = btrim(p_file_fingerprint)
     for update;

  insert into public.invoice_work_runs (
    brand_id,
    file_fingerprint,
    source_file_name,
    completed_by,
    worker_label,
    completed_at,
    source_row_count,
    source_order_count
  )
  values (
    p_brand_id,
    btrim(p_file_fingerprint),
    coalesce(p_source_file_name, ''),
    auth.uid(),
    coalesce(p_worker_label, ''),
    now(),
    coalesce(p_source_row_count, 0),
    coalesce(p_source_order_count, 0)
  )
  on conflict (brand_id, file_fingerprint)
  do update set
    source_file_name = excluded.source_file_name,
    completed_by = excluded.completed_by,
    worker_label = excluded.worker_label,
    completed_at = excluded.completed_at,
    source_row_count = excluded.source_row_count,
    source_order_count = excluded.source_order_count
  returning id into v_run_id;

  delete from public.invoice_work_site_summaries
   where brand_id = p_brand_id
     and run_id = v_run_id
     and not (usage_target_id = any (v_target_ids));

  for v_site in
    select value
      from jsonb_array_elements(p_sites)
     order by value->>'usage_target_id'
  loop
    insert into public.invoice_work_site_summaries (
      brand_id,
      run_id,
      usage_target_id,
      source_mall_names,
      order_count,
      source_row_count,
      source_quantity
    )
    values (
      p_brand_id,
      v_run_id,
      (v_site->>'usage_target_id')::uuid,
      coalesce(v_site->>'source_mall_names', ''),
      coalesce((v_site->>'order_count')::integer, 0),
      coalesce((v_site->>'source_row_count')::integer, 0),
      coalesce((v_site->>'source_quantity')::integer, 0)
    )
    on conflict (brand_id, run_id, usage_target_id)
    do update set
      source_mall_names = excluded.source_mall_names,
      order_count = excluded.order_count,
      source_row_count = excluded.source_row_count,
      source_quantity = excluded.source_quantity;
  end loop;

  delete from public.invoice_work_run_order_keys
   where brand_id = p_brand_id
     and run_id = v_run_id;

  if coalesce(array_length(v_hash_seen, 1), 0) > 0 then
    insert into public.invoice_work_run_order_keys (
      brand_id,
      run_id,
      order_key_hash
    )
    select
      p_brand_id,
      v_run_id,
      h
    from unnest(v_hash_seen) as h;
  end if;

  return v_run_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_barcode_data_entry_run(p_brand_id uuid, p_run_id uuid, p_company_key text, p_shipped_on date, p_note text, p_worker_label text, p_entries jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  item jsonb;
  v_run_id uuid;
  v_company_key text;
  v_note text;
  v_source_ref text;
  v_style_id uuid;
  v_target_id uuid;
  v_qty integer;
  v_key text;
  v_seen text[] := array[]::text[];
  v_inserted integer := 0;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  v_company_key := btrim(coalesce(p_company_key, ''));
  if v_company_key = '' then
    raise exception '출고업체 정보가 올바르지 않습니다.';
  end if;
  if p_shipped_on is null then
    raise exception '출고일을 확인하세요.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  v_note := coalesce(p_note, '');

  for item in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '상품 정보가 올바르지 않습니다.';
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '출고업체 정보가 올바르지 않습니다.';
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);

    if v_style_id is null then
      raise exception '상품 정보가 올바르지 않습니다.';
    end if;
    if v_target_id is null then
      raise exception '출고업체 정보가 올바르지 않습니다.';
    end if;
    if v_qty <= 0 then
      raise exception '출고 수량은 1 이상이어야 합니다.';
    end if;
    if not exists (
      select 1 from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 상품만 반영할 수 있습니다.';
    end if;
    if not exists (
      select 1 from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 출고업체만 반영할 수 있습니다.';
    end if;

    v_key := v_style_id::text || '|' || v_target_id::text;
    if v_key = any (v_seen) then
      raise exception '같은 상품·지점이 두 번 들어 있습니다.';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  if p_run_id is null then
    insert into public.barcode_data_entry_runs (
      brand_id, company_key, shipped_on, note, worker_label,
      created_by, registered_at
    ) values (
      p_brand_id, v_company_key, p_shipped_on, v_note,
      coalesce(p_worker_label, ''), auth.uid(), now()
    )
    returning id into v_run_id;
  else
    update public.barcode_data_entry_runs
    set shipped_on = p_shipped_on,
        note = v_note
    where brand_id = p_brand_id
      and id = p_run_id
    returning id into v_run_id;

    if v_run_id is null then
      raise exception '등록 이력을 찾지 못했습니다.';
    end if;
  end if;

  v_source_ref := 'barcode-data-entry:' || v_run_id::text;

  perform 1
    from public.outbound_shipments
   where brand_id = p_brand_id
     and source = 'bulk'
     and source_ref = v_source_ref
   for update;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = v_source_ref;

  for item in
    select value
      from jsonb_array_elements(p_entries)
     order by value->>'usageTargetId', value->>'styleId'
  loop
    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      (item->>'styleId')::uuid,
      (item->>'usageTargetId')::uuid,
      p_shipped_on,
      (item->>'quantity')::int,
      'bulk',
      v_source_ref,
      v_note
    );
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  return v_run_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.move_warehouse_box(p_brand_id uuid, p_box_id uuid, p_location_code text, p_zone text)
 RETURNS warehouse_boxes
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
  v_location_id uuid;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;
  if v_box.completed_at is not null then
    raise exception '종료된 박스는 수정할 수 없습니다.';
  end if;

  v_location_id := app.ensure_warehouse_box_location(
    p_brand_id,
    p_location_code,
    p_zone
  );
  if v_location_id = v_box.location_id then
    return v_box;
  end if;

  update public.warehouse_boxes
  set location_id = v_location_id
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'move',
    v_box.location_id,
    v_next.location_id,
    v_next.current_qty,
    v_next.current_qty,
    '개별 박스 자리 이동'
  );

  return v_next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_warehouse_box(p_brand_id uuid, p_display_code text, p_style_id uuid, p_location_code text, p_zone text, p_received_on date, p_initial_qty integer, p_current_qty integer, p_usage_priority text DEFAULT 'fifo'::text, p_note text DEFAULT ''::text, p_source_position_id uuid DEFAULT NULL::uuid)
 RETURNS warehouse_boxes
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_priority text;
  v_location_id uuid;
  v_box public.warehouse_boxes;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  v_code := upper(btrim(coalesce(p_display_code, '')));
  v_priority := coalesce(nullif(btrim(p_usage_priority), ''), 'fifo');
  if v_code = '' then
    raise exception '박스 고유번호를 입력하세요.';
  end if;
  if p_style_id is null then
    raise exception 'M번호를 선택하세요.';
  end if;
  if p_received_on is null then
    raise exception '입고일을 입력하세요.';
  end if;
  if p_initial_qty is null or p_initial_qty < 1 then
    raise exception '최초 입수는 1 이상의 정수로 입력하세요.';
  end if;
  if p_current_qty is null or p_current_qty < 0 then
    raise exception '현재 수량은 0 이상의 정수로 입력하세요.';
  end if;
  if p_current_qty > p_initial_qty then
    raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
  end if;
  if v_priority not in ('first', 'second', 'fifo', 'last') then
    raise exception '사용 순서가 올바르지 않습니다.';
  end if;

  v_location_id := app.ensure_warehouse_box_location(
    p_brand_id,
    p_location_code,
    p_zone
  );

  begin
    insert into public.warehouse_boxes (
      brand_id,
      set_id,
      display_code,
      location_id,
      style_id,
      received_on,
      initial_qty,
      current_qty,
      usage_priority,
      note,
      source_position_id,
      created_by
    )
    values (
      p_brand_id,
      null,
      v_code,
      v_location_id,
      p_style_id,
      p_received_on,
      p_initial_qty,
      p_current_qty,
      v_priority,
      coalesce(p_note, ''),
      p_source_position_id,
      auth.uid()
    )
    returning * into v_box;
  exception
    when unique_violation then
      raise exception '이미 등록된 박스 고유번호입니다.';
  end;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_box.id,
    'create',
    null,
    v_box.location_id,
    null,
    v_box.current_qty,
    '개별 박스 등록'
  );
  if v_box.status = 'opened' then
    perform app.insert_warehouse_box_movement(
      p_brand_id,
      v_box.id,
      'open',
      v_box.location_id,
      v_box.location_id,
      v_box.initial_qty,
      v_box.current_qty,
      '등록 시 개봉'
    );
  elsif v_box.status = 'depleted' then
    perform app.insert_warehouse_box_movement(
      p_brand_id,
      v_box.id,
      'deplete',
      v_box.location_id,
      v_box.location_id,
      v_box.initial_qty,
      v_box.current_qty,
      '등록 시 소진'
    );
    update public.warehouse_boxes
    set
      completed_at = now(),
      completed_by = auth.uid(),
      completion_kind = 'depleted'
    where id = v_box.id
      and brand_id = p_brand_id
    returning * into v_box;
  end if;

  return v_box;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_warehouse_box(p_brand_id uuid, p_box_id uuid, p_current_qty integer DEFAULT NULL::integer, p_usage_priority text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS warehouse_boxes
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
  v_priority text;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;
  if p_current_qty is null
    and p_usage_priority is null
    and p_note is null then
    raise exception '수정할 값이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;
  if v_box.completed_at is not null then
    raise exception '종료된 박스는 수정할 수 없습니다.';
  end if;

  if p_current_qty is not null then
    if p_current_qty < 0 then
      raise exception '현재 수량은 0 이상의 정수로 입력하세요.';
    end if;
    if p_current_qty > v_box.initial_qty then
      raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
    end if;
  end if;

  v_priority := coalesce(nullif(btrim(p_usage_priority), ''), v_box.usage_priority);
  if v_priority not in ('first', 'second', 'fifo', 'last') then
    raise exception '사용 순서가 올바르지 않습니다.';
  end if;

  update public.warehouse_boxes
  set
    current_qty = coalesce(p_current_qty, current_qty),
    usage_priority = v_priority,
    note = coalesce(p_note, note)
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'update',
    v_next.location_id,
    v_next.location_id,
    v_box.current_qty,
    v_next.current_qty,
    '개별 박스 수정'
  );
  if v_next.status is distinct from v_box.status then
    if v_next.status = 'opened' then
      perform app.insert_warehouse_box_movement(
        p_brand_id,
        v_next.id,
        'open',
        v_next.location_id,
        v_next.location_id,
        v_box.current_qty,
        v_next.current_qty,
        '수량 수정으로 개봉'
      );
    elsif v_next.status = 'depleted' then
      perform app.insert_warehouse_box_movement(
        p_brand_id,
        v_next.id,
        'deplete',
        v_next.location_id,
        v_next.location_id,
        v_box.current_qty,
        v_next.current_qty,
        '수량 수정으로 소진'
      );
    end if;
  end if;

  if v_next.status = 'depleted' and v_next.completed_at is null then
    update public.warehouse_boxes
    set
      completed_at = now(),
      completed_by = auth.uid(),
      completion_kind = 'depleted'
    where id = v_next.id
      and brand_id = p_brand_id
    returning * into v_next;
  end if;

  return v_next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_warehouse_box_outbound(p_brand_id uuid, p_box_id uuid, p_reason text DEFAULT ''::text)
 RETURNS warehouse_boxes
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_box public.warehouse_boxes;
  v_next public.warehouse_boxes;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '개별 박스를 수정할 권한이 없습니다.';
  end if;

  select *
    into v_box
  from public.warehouse_boxes
  where id = p_box_id
    and brand_id = p_brand_id
  for update;
  if v_box.id is null then
    raise exception '박스를 찾지 못했습니다.';
  end if;
  if v_box.archived_at is not null then
    raise exception '보관된 박스는 수정할 수 없습니다.';
  end if;
  if v_box.completed_at is not null then
    return v_box;
  end if;
  if v_box.current_qty <> v_box.initial_qty or v_box.status <> 'sealed' then
    raise exception '개봉된 박스는 박스 단위로 출고할 수 없습니다. 남은 수량을 0으로 소진하세요.';
  end if;
  if v_box.current_qty <= 0 then
    raise exception '출고할 수량이 없습니다.';
  end if;

  update public.warehouse_boxes
  set
    current_qty = 0,
    completed_at = now(),
    completed_by = auth.uid(),
    completion_kind = 'box_outbound'
  where id = v_box.id
    and brand_id = p_brand_id
  returning * into v_next;

  perform app.insert_warehouse_box_movement(
    p_brand_id,
    v_next.id,
    'box_outbound',
    v_next.location_id,
    v_next.location_id,
    v_box.current_qty,
    0,
    coalesce(nullif(btrim(p_reason), ''), '밀봉 박스 단위 출고')
  );

  return v_next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_cargo_inbound_tidy_rows(p_brand_id uuid, p_shipment_id uuid, p_rows jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_stage text;
  v_saved_at timestamptz;
begin
  if p_brand_id is null or p_shipment_id is null then
    raise exception '화물을 확인하세요.' using errcode = '22023';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 5000 then
    raise exception '창고정리용 목록은 1행 이상 5000행 이하로 저장해야 합니다.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) element
    where jsonb_typeof(element) <> 'object'
  ) then
    raise exception '창고정리용 목록 형식이 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  select shipment.stage
  into v_stage
  from public.cargo_inbound_shipments shipment
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception '화물을 찾지 못했습니다.' using errcode = 'P0002';
  end if;
  if v_stage <> 'scheduled' then
    raise exception '입고일 협의 단계에서만 창고정리용 목록을 저장할 수 있습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from rows from (
      jsonb_to_recordset(p_rows) as (
        line_id uuid,
        part_index integer,
        quantity integer,
        units_per_box integer,
        box_count integer,
        latest_box_count integer
      )
    ) as row(
      line_id,
      part_index,
      quantity,
      units_per_box,
      box_count,
      latest_box_count
    )
    where coalesce(row.part_index, 0) < 0
      or coalesce(row.quantity, 0) < 0
      or (row.units_per_box is not null and row.units_per_box <= 0)
      or coalesce(row.box_count, 0) < 0
      or coalesce(row.latest_box_count, 0) < 0
  ) then
    raise exception '창고정리용 수량을 확인하세요.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from rows from (
      jsonb_to_recordset(p_rows) as (line_id uuid)
    ) as row(line_id)
    where row.line_id is not null
      and not exists (
        select 1
        from public.cargo_inbound_lines line
        where line.brand_id = p_brand_id
          and line.shipment_id = p_shipment_id
          and line.id = row.line_id
      )
  ) then
    raise exception '이 화물에 없는 품목이 포함되어 있습니다.'
      using errcode = '22023';
  end if;

  delete from public.cargo_inbound_tidy_rows tidy
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id;

  insert into public.cargo_inbound_tidy_rows (
    brand_id,
    shipment_id,
    line_id,
    row_no,
    part_index,
    item_no,
    product_name,
    style_no,
    quantity,
    units_per_box,
    box_count,
    stow_label,
    note,
    shipped_code,
    latest_slot,
    latest_box_count
  )
  select
    p_brand_id,
    p_shipment_id,
    src.line_id,
    src.row_no::integer,
    coalesce(src.part_index, 0),
    btrim(coalesce(src.item_no, '')),
    btrim(coalesce(src.product_name, '')),
    btrim(coalesce(src.style_no, '')),
    src.quantity,
    src.units_per_box,
    src.box_count,
    btrim(coalesce(src.stow_label, '')),
    btrim(coalesce(src.note, '')),
    btrim(coalesce(src.shipped_code, '')),
    btrim(coalesce(src.latest_slot, '')),
    src.latest_box_count
  from rows from (
    jsonb_to_recordset(p_rows) as (
      line_id uuid,
      part_index integer,
      item_no text,
      product_name text,
      style_no text,
      quantity integer,
      units_per_box integer,
      box_count integer,
      stow_label text,
      note text,
      shipped_code text,
      latest_slot text,
      latest_box_count integer
    )
  ) with ordinality as src(
    line_id,
    part_index,
    item_no,
    product_name,
    style_no,
    quantity,
    units_per_box,
    box_count,
    stow_label,
    note,
    shipped_code,
    latest_slot,
    latest_box_count,
    row_no
  );

  update public.cargo_inbound_shipments shipment
  set tidy_saved_at = now()
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  returning shipment.tidy_saved_at into v_saved_at;

  return v_saved_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_cargo_inbound_tidy_slots(p_brand_id uuid, p_shipment_id uuid, p_slots jsonb, p_complete boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_stage text;
  v_saved_at timestamptz;
  v_total integer;
  v_filled integer;
begin
  if p_brand_id is null or p_shipment_id is null then
    raise exception '화물을 확인하세요.' using errcode = '22023';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > 5000 then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_slots) element
    where jsonb_typeof(element) <> 'object'
  ) then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;

  select shipment.stage, shipment.tidy_saved_at
  into v_stage, v_saved_at
  from public.cargo_inbound_shipments shipment
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception '화물을 찾지 못했습니다.' using errcode = 'P0002';
  end if;
  if v_stage <> 'scheduled' then
    raise exception '입고일 협의 단계에서만 창고자리를 저장할 수 있습니다.'
      using errcode = '22023';
  end if;
  if v_saved_at is null then
    raise exception '창고정리용 목록이 없습니다. 먼저 인쇄하세요.'
      using errcode = '22023';
  end if;

  select count(*)::integer
  into v_total
  from public.cargo_inbound_tidy_rows tidy
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id;

  if v_total = 0 then
    raise exception '창고정리용 목록이 없습니다. 먼저 인쇄하세요.'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_slots) as slot(id uuid)
  ) <> (
    select count(distinct slot.id)
    from jsonb_to_recordset(p_slots) as slot(id uuid)
  ) then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_slots) as slot(warehouse_slot text)
    where char_length(btrim(coalesce(slot.warehouse_slot, ''))) > 80
  ) then
    raise exception '창고자리는 80자 이하로 입력하세요.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_slots) as slot(id uuid)
    where slot.id is null
      or not exists (
        select 1
        from public.cargo_inbound_tidy_rows tidy
        where tidy.brand_id = p_brand_id
          and tidy.shipment_id = p_shipment_id
          and tidy.id = slot.id
      )
  ) then
    raise exception '목록이 바뀌었습니다. 다시 열어 주세요.'
      using errcode = '22023';
  end if;

  update public.cargo_inbound_tidy_rows tidy
  set warehouse_slot = btrim(coalesce(slot.warehouse_slot, ''))
  from jsonb_to_recordset(p_slots) as slot(id uuid, warehouse_slot text)
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id
    and tidy.id = slot.id;

  if coalesce(p_complete, false) then
    select
      count(*)::integer,
      count(*) filter (where btrim(tidy.warehouse_slot) <> '')::integer
    into v_total, v_filled
    from public.cargo_inbound_tidy_rows tidy
    where tidy.brand_id = p_brand_id
      and tidy.shipment_id = p_shipment_id;

    update public.cargo_inbound_shipments shipment
    set
      stage = 'done',
      completed_at = now(),
      warehouse_summary = '창고자리 ' || v_filled::text || '/' || v_total::text || '행 입력'
    where shipment.brand_id = p_brand_id
      and shipment.id = p_shipment_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_outbound_partner_unit_atomic(p_brand_id uuid, p_id uuid, p_name text, p_normalized_name text, p_channel_type text, p_shipping_method text, p_is_one_time boolean, p_active boolean, p_note text, p_folder_id uuid, p_group_id uuid, p_group_name text, p_site_name text, p_normalized_site_name text, p_contact_name text, p_contact_phone text, p_contact_email text, p_address text, p_aliases jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_group_id uuid := p_group_id;
  v_group_name text := btrim(regexp_replace(coalesce(p_group_name, ''), '\s+', ' ', 'g'));
  v_group_key text := app.outbound_partner_name_key(v_group_name);
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
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
$function$
;

CREATE OR REPLACE FUNCTION public.md_price_can_refresh(p_brand_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('md',p_brand_id))
$function$
;

create or replace function app.china_work_order(p_draft uuid,p_order text,p_kind text,p_action text,p_assignee uuid,p_revision timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare d public.product_drafts%rowtype; items jsonb; item jsonb; idx int; target jsonb; assignee_name text;
begin
 if not app.basic_work_allowed('china') then raise exception '중국팀 작업 권한이 없습니다.' using errcode='42501'; end if;
 select * into d from public.product_drafts where id=p_draft and company_id='e0000000-0000-4000-8000-000000000001' for update;
 if not found then raise exception '기획안을 찾을 수 없습니다.'; end if;
 if d.updated_at is distinct from p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if p_kind not in ('sample','color') or p_action not in ('assign','check','ship') then raise exception '지원하지 않는 지시서 작업입니다.'; end if;
 if p_kind='color' then
  if p_action<>'ship' then raise exception '컬러 지시서는 발송 처리만 가능합니다.'; end if;
  select value into target from (select jsonb_build_object('id',c.id) value from public.draft_colors c where c.id::text=p_order and c.draft_id=p_draft and c.sample_work_order_url is not null) v;
  if target is null then raise exception '컬러 지시서를 찾지 못했습니다.'; end if;
  perform set_config('app.china_workorder','on',true);
  update public.draft_colors set sample_work_order_shipped=true,sample_work_order_shipped_at=coalesce(sample_work_order_shipped_at,now()) where id::text=p_order and draft_id=p_draft;
  update public.product_drafts set specs=case when jsonb_array_length(coalesce(specs->'colorSampleRounds','[]'))>0 then jsonb_set(specs,array['colorSampleRounds',(jsonb_array_length(specs->'colorSampleRounds')-1)::text,'returnedAt'],to_jsonb(coalesce(nullif(specs->'colorSampleRounds'->-1->>'returnedAt',''),now()::text))) else specs end,updated_at=clock_timestamp() where id=p_draft;
 else
  items:=d.sample_work_orders;
  select value,ordinality::int-1 into item,idx from jsonb_array_elements(items) with ordinality where value->>'id'=p_order;
  if item is null or nullif(item->>'url','') is null then raise exception '지시서를 찾지 못했습니다.'; end if;
  if p_action='assign' then
   if p_assignee is not null then select display_name into assignee_name from public.profiles where id=p_assignee and status='active' and company_id=d.company_id and department_id=app.work_department('china'); if not found then raise exception '중국팀 재직 직원을 선택하세요.'; end if; end if;
   item:=item||jsonb_build_object('assigneeId',p_assignee,'assigneeName',coalesce(assignee_name,''));
  elsif p_action='check' then item:=item||jsonb_build_object('fileCheckedAt',coalesce(item->>'fileCheckedAt',now()::text));
  else item:=item||jsonb_build_object('returnedAt',coalesce(item->>'returnedAt',now()::text)); end if;
  items:=jsonb_set(items,array[idx::text],item);
  perform set_config('app.china_workorder','on',true);
  update public.product_drafts set sample_work_orders=items,updated_at=clock_timestamp() where id=p_draft;
 end if;
 perform set_config('app.china_workorder','off',true);
end $$;
create or replace function public.apply_china_work_order(p_draft uuid,p_order text,p_kind text,p_action text,p_assignee uuid,p_revision timestamptz) returns void language sql set search_path='' as $$ select app.china_work_order(p_draft,p_order,p_kind,p_action,p_assignee,p_revision); $$;
revoke all on function app.china_work_order(uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function app.china_work_order(uuid,text,text,text,uuid,timestamptz) to authenticated;
revoke all on function public.apply_china_work_order(uuid,text,text,text,uuid,timestamptz) from public,anon;
grant execute on function public.apply_china_work_order(uuid,text,text,text,uuid,timestamptz) to authenticated;
revoke all on function app.work_operator(),app.work_department(text),app.basic_work_allowed(text,uuid),app.work_manage_allowed(text),app.draft_write_allowed(uuid) from public,anon;
grant execute on function app.work_operator(),app.work_department(text),app.basic_work_allowed(text,uuid),app.work_manage_allowed(text),app.draft_write_allowed(uuid) to authenticated;

-- Cache invalidation/feedback is part of the existing invoice save transaction.
create policy basic_work_insert on public.ai_recommendation_feedback for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.ai_recommendation_feedback for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.ai_item_name_recommendation_feedback for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.ai_item_name_recommendation_feedback for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_insert on public.ai_item_name_recommendation_feedback_components for insert to authenticated with check (app.basic_work_allowed('logistics',brand_id));
create policy basic_work_update on public.ai_item_name_recommendation_feedback_components for update to authenticated using (app.basic_work_allowed('logistics',brand_id)) with check (app.basic_work_allowed('logistics',brand_id));
CREATE OR REPLACE FUNCTION app.invalidate_ai_recommendation_cache(p_brand_id uuid, p_normalized_lookup_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_keys text[];
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception 'not allowed';
  end if;

  select coalesce(array_agg(distinct k), array[]::text[])
  into v_keys
  from (
    select app.normalize_invoice_lookup_key(t) as k
    from unnest(coalesce(p_normalized_lookup_keys, array[]::text[])) as t
  ) n
  where n.k <> '';

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return;
  end if;

  delete from public.ai_recommendation_cache c
  where c.brand_id = p_brand_id
    and c.feature_key = 'invoice_product_recommendation'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.lookup_keys, '[]'::jsonb)) as t(cached_key)
      where app.normalize_invoice_lookup_key(t.cached_key) = any (v_keys)
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_invoice_gift_allocations(p_brand_id uuid, p_request_id uuid, p_order_fingerprint text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if p_brand_id is null or p_request_id is null then
    raise exception 'brand_id와 request_id가 필요합니다.';
  end if;
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 사은품 배정을 취소할 권한이 없습니다.';
  end if;
  if btrim(coalesce(p_order_fingerprint, '')) = '' then
    raise exception 'order_fingerprint가 필요합니다.';
  end if;

  perform 1
  from public.invoice_prefix_requests r
  where r.brand_id = p_brand_id
    and r.id = p_request_id
  for update;

  update public.invoice_gift_allocations a
  set cancelled_at = now()
  where a.brand_id = p_brand_id
    and a.request_id = p_request_id
    and a.order_fingerprint = btrim(p_order_fingerprint)
    and a.cancelled_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.invalidate_ai_recommendation_cache(p_brand_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception 'not allowed';
  end if;
  delete from public.ai_recommendation_cache
  where brand_id = p_brand_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.invalidate_ai_recommendation_cache(p_brand_id uuid, p_feature_key text, p_normalized_lookup_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_keys text[];
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception 'not allowed';
  end if;
  if coalesce(btrim(p_feature_key), '') = '' then
    delete from public.ai_recommendation_cache
    where brand_id = p_brand_id;
    return;
  end if;

  select coalesce(array_agg(distinct k), array[]::text[])
  into v_keys
  from (
    select app.normalize_invoice_lookup_key(t) as k
    from unnest(coalesce(p_normalized_lookup_keys, array[]::text[])) as t
  ) n
  where n.k <> '';

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    delete from public.ai_recommendation_cache c
    where c.brand_id = p_brand_id
      and c.feature_key = p_feature_key;
    return;
  end if;

  delete from public.ai_recommendation_cache c
  where c.brand_id = p_brand_id
    and c.feature_key = p_feature_key
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.lookup_keys, '[]'::jsonb)) as t(cached_key)
      where app.normalize_invoice_lookup_key(t.cached_key) = any (v_keys)
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.invalidate_ai_recommendation_cache_for_feature(p_brand_id uuid, p_feature_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 AI 캐시를 지울 권한이 없습니다.';
  end if;
  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    p_feature_key,
    array[]::text[]
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_ai_recommendation_feedback(p_brand_id uuid, p_lookup_key text, p_style_id uuid, p_source text, p_cache_id uuid DEFAULT NULL::uuid, p_shown_rank integer DEFAULT NULL::integer, p_provider text DEFAULT NULL::text, p_model_id text DEFAULT NULL::text, p_map_id uuid DEFAULT NULL::uuid, p_suggested_style_id uuid DEFAULT NULL::uuid, p_outcome text DEFAULT 'confirmed'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'confirmed');
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if p_lookup_key is null or btrim(p_lookup_key) = '' or p_style_id is null then
    return;
  end if;
  if p_source not in ('manual', 'local', 'ai') then
    raise exception '지원하지 않는 피드백 출처입니다.';
  end if;
  if v_outcome not in ('confirmed', 'corrected', 'reverted') then
    raise exception '지원하지 않는 피드백 결과입니다.';
  end if;

  insert into public.ai_recommendation_feedback (
    brand_id,
    user_id,
    cache_id,
    map_id,
    lookup_key,
    normalized_lookup_key,
    style_id,
    suggested_style_id,
    shown_rank,
    source,
    outcome,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_cache_id,
    p_map_id,
    btrim(p_lookup_key),
    app.normalize_invoice_lookup_key(p_lookup_key),
    p_style_id,
    p_suggested_style_id,
    p_shown_rank,
    p_source,
    v_outcome,
    p_provider,
    p_model_id
  );

  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    'invoice_product_recommendation',
    array[app.normalize_invoice_lookup_key(p_lookup_key)]
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_ai_item_name_recommendation_feedback(p_brand_id uuid, p_rule_id uuid, p_item_name text, p_scope text, p_action text, p_source text, p_main_style_id uuid DEFAULT NULL::uuid, p_product_lookup_key text DEFAULT ''::text, p_cache_id uuid DEFAULT NULL::uuid, p_provider text DEFAULT NULL::text, p_model_id text DEFAULT NULL::text, p_outcome text DEFAULT 'confirmed'::text, p_suggested_action text DEFAULT NULL::text, p_components jsonb DEFAULT '[]'::jsonb, p_suggested_components jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'confirmed');
  v_lookup text := coalesce(p_product_lookup_key, '');
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 내품명 기준을 저장할 권한이 없습니다.';
  end if;
  if p_item_name is null or btrim(p_item_name) = '' then
    return null;
  end if;
  if p_scope not in ('global', 'main_style', 'lookup_key')
     or p_action not in ('delete', 'components')
     or p_source not in ('manual', 'local', 'ai')
     or v_outcome not in ('confirmed', 'corrected', 'reverted') then
    raise exception '지원하지 않는 내품명 피드백 값입니다.';
  end if;

  insert into public.ai_item_name_recommendation_feedback (
    brand_id,
    user_id,
    rule_id,
    cache_id,
    item_name,
    normalized_item_name,
    main_style_id,
    product_lookup_key,
    normalized_product_lookup_key,
    scope,
    action,
    suggested_action,
    source,
    outcome,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_rule_id,
    p_cache_id,
    btrim(p_item_name),
    app.normalize_invoice_lookup_key(p_item_name),
    p_main_style_id,
    v_lookup,
    app.normalize_invoice_lookup_key(v_lookup),
    p_scope,
    p_action,
    nullif(btrim(coalesce(p_suggested_action, '')), ''),
    p_source,
    v_outcome,
    p_provider,
    p_model_id
  )
  returning id into v_id;

  insert into public.ai_item_name_recommendation_feedback_components (
    brand_id, feedback_id, style_id, quantity, kind, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    'confirmed',
    ordinality - 1
  from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(item->>'styleId', '') is not null;

  insert into public.ai_item_name_recommendation_feedback_components (
    brand_id, feedback_id, style_id, quantity, kind, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    'suggested',
    ordinality - 1
  from jsonb_array_elements(coalesce(p_suggested_components, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(item->>'styleId', '') is not null;

  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    'invoice_item_name_recommendation',
    array_remove(
      array[
        app.normalize_invoice_lookup_key(p_item_name),
        app.normalize_invoice_lookup_key(v_lookup)
      ],
      ''
    )
  );

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.save_invoice_item_name_rule_with_feedback(p_brand_id uuid, p_row jsonb, p_rule_id uuid DEFAULT NULL::uuid, p_feedback jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_id uuid;
  v_scope text := coalesce(p_row->>'scope', '');
  v_item text := btrim(coalesce(p_row->>'item_name', ''));
  v_norm_item text := coalesce(
    nullif(btrim(p_row->>'normalized_item_name'), ''),
    app.normalize_invoice_lookup_key(v_item)
  );
  v_main uuid := nullif(p_row->>'main_style_id', '')::uuid;
  v_lookup text := coalesce(p_row->>'product_lookup_key', '');
  v_norm_lookup text := coalesce(
    nullif(btrim(p_row->>'normalized_product_lookup_key'), ''),
    app.normalize_invoice_lookup_key(v_lookup)
  );
  v_action text := coalesce(p_row->>'action', '');
  v_source text;
  v_outcome text;
begin
  if not (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics',p_brand_id)) then
    raise exception '이 브랜드의 내품명 기준을 저장할 권한이 없습니다.';
  end if;
  if v_item = '' or v_scope not in ('global', 'main_style', 'lookup_key')
     or v_action not in ('delete', 'components') then
    raise exception '내품명 규칙 값이 올바르지 않습니다.';
  end if;
  if v_scope = 'global' then
    v_main := null;
    v_lookup := '';
    v_norm_lookup := '';
  elsif v_scope = 'main_style' then
    v_lookup := '';
    v_norm_lookup := '';
  end if;

  if p_rule_id is not null then
    v_id := p_rule_id;
  else
    select r.id into v_id
    from public.invoice_item_name_rules r
    where r.brand_id = p_brand_id
      and r.is_active
      and r.scope = v_scope
      and r.normalized_item_name = v_norm_item
      and r.main_style_id is not distinct from v_main
      and r.normalized_product_lookup_key = v_norm_lookup
    limit 1;
  end if;

  if v_id is null then
    insert into public.invoice_item_name_rules (
      brand_id,
      scope,
      main_style_id,
      item_name,
      normalized_item_name,
      product_lookup_key,
      normalized_product_lookup_key,
      action,
      is_active,
      note
    ) values (
      p_brand_id,
      v_scope,
      v_main,
      v_item,
      v_norm_item,
      v_lookup,
      v_norm_lookup,
      v_action,
      coalesce((p_row->>'is_active')::boolean, true),
      coalesce(p_row->>'note', '')
    )
    returning id into v_id;
  else
    update public.invoice_item_name_rules
    set
      scope = v_scope,
      main_style_id = v_main,
      item_name = v_item,
      normalized_item_name = v_norm_item,
      product_lookup_key = v_lookup,
      normalized_product_lookup_key = v_norm_lookup,
      action = v_action,
      is_active = coalesce((p_row->>'is_active')::boolean, true),
      note = coalesce(p_row->>'note', '')
    where id = v_id
      and brand_id = p_brand_id;
  end if;

  delete from public.invoice_item_name_rule_components
  where rule_id = v_id
    and brand_id = p_brand_id;

  insert into public.invoice_item_name_rule_components (
    brand_id, rule_id, style_id, role, quantity, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    coalesce(nullif(item->>'role', ''), 'included'),
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    ordinality - 1
  from jsonb_array_elements(coalesce(p_row->'components', '[]'::jsonb))
    with ordinality as t(item, ordinality)
  where v_action = 'components'
    and nullif(item->>'styleId', '') is not null;

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  v_outcome := coalesce(nullif(btrim(p_feedback->>'outcome'), ''), 'confirmed');
  if v_source is not null then
    perform public.record_ai_item_name_recommendation_feedback(
      p_brand_id,
      v_id,
      v_item,
      v_scope,
      v_action,
      v_source,
      v_main,
      v_lookup,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', ''),
      v_outcome,
      nullif(p_feedback->>'suggested_action', ''),
      coalesce(p_row->'components', '[]'::jsonb),
      coalesce(p_feedback->'suggested_components', '[]'::jsonb)
    );
  else
    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      'invoice_item_name_recommendation',
      array_remove(array[v_norm_item, v_norm_lookup], '')
    );
  end if;

  return v_id;
end;
$function$
;

-- Action-specific operations writes; approval, deletion and assignment helpers remain unchanged.
CREATE OR REPLACE FUNCTION app.save_attendance_start_settings(p_month date, p_until date, p_department_id uuid, p_employee_id uuid, p_start time without time zone, p_grace integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); company uuid; target_department uuid; target_month date; inherited_time time; inherited_grace integer; count_months integer:=0;
begin
  if actor is null then raise exception '운영지원팀만 출근시간을 저장할 수 있습니다.'; end if;
  select company_id into company from public.profiles where id=actor and status='active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_month is null or p_until is null or extract(day from p_month)<>1 or extract(day from p_until)<>1
    or p_until<p_month or extract(year from p_until)<>extract(year from p_month)
    or p_grace is null or p_grace<0 or p_grace>60 then raise exception '적용 월과 초과 기준을 확인해 주세요.'; end if;
  if p_start is not null and extract(second from p_start)<>0 then raise exception '출근시간은 분 단위로 입력해 주세요.'; end if;
  if p_employee_id is not null then
    select department_id into target_department from public.profiles where id=p_employee_id and company_id=company and status='active';
    if not found then raise exception '같은 회사의 재직 직원만 설정할 수 있습니다.'; end if;
  else
    if p_start is null or not exists(select 1 from public.departments where id=p_department_id and company_id=company and is_active) then raise exception '부서와 출근시간을 확인해 주세요.'; end if;
    target_department:=p_department_id;
  end if;
  if not (app.can_edit_org_assignment() or app.basic_work_allowed('operations')) and (p_employee_id is null or not app.can_set_department_attendance(company, target_department)) then
    raise exception '운영지원팀만 출근시간을 저장할 수 있습니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company::text||':attendance-start',0));
  for target_month in select d::date from pg_catalog.generate_series(p_month::timestamp,p_until::timestamp,interval '1 month') d loop
    if p_employee_id is null then
      insert into public.attendance_start_settings(company_id,month,department_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,'department',p_start,p_grace,actor)
      on conflict(company_id,department_id,month) where employee_id is null do update
      set start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      select company,target_month,target_department,p.id,'department',p_start,p_grace,actor from public.profiles p
      where p.company_id=company and p.department_id=target_department and p.status='active'
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now()
      where attendance_start_settings.source='department';
    else
      inherited_time:=null; inherited_grace:=5;
      if p_start is null then
        select start_time,grace_minutes into inherited_time,inherited_grace from public.attendance_start_settings
        where company_id=company and department_id=target_department and month=target_month and employee_id is null;
      end if;
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,p_employee_id,case when p_start is null then 'department' else 'individual' end,
        coalesce(p_start,inherited_time),case when p_start is null then coalesce(inherited_grace,5) else p_grace end,actor)
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,source=excluded.source,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
    end if;
    count_months:=count_months+1;
  end loop;
  return count_months;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.guard_profile_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_is_admin boolean;
  actor_can_approve boolean;
  self_access_request boolean;
begin
  -- Only organization fields; no login, approval, identity or permission changes.
  if auth.uid() is not null and auth.uid() <> old.id
    and app.basic_work_allowed('operations')
    and old.company_id = (select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active')
    and (to_jsonb(new)-array['department_id','position','job_grade','hire_date','updated_at'])
      = (to_jsonb(old)-array['department_id','position','job_grade','hire_date','updated_at']) then
    if new.department_id is not null and not exists(select 1 from public.departments d where d.id=new.department_id and d.company_id=old.company_id and d.is_active) then
      raise exception '같은 회사의 활성 부서를 선택해 주세요.';
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  ) into actor_is_admin;

  self_access_request := auth.uid() = old.id
    and old.status in ('pending', 'rejected')
    and new.status = 'pending';

  if new.department_id is distinct from old.department_id
     or new.position is distinct from old.position
     or new.job_grade is distinct from old.job_grade then
    if not app.can_edit_org_assignment()
       and not (
         self_access_request
         and new.company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
         and new.position is not distinct from old.position
         and new.job_grade is not distinct from old.job_grade
         and exists (
           select 1 from public.departments d
           where d.id = new.department_id
             and d.company_id = new.company_id
             and d.is_active = true
         )
       ) then
      raise exception '부서와 직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
    end if;
  end if;

  if new.position is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'duty'
      and t.name = new.position
  ) then
    raise exception '등록된 직책이 아닙니다.';
  end if;
  if new.job_grade is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'grade'
      and t.name = new.job_grade
  ) then
    raise exception '등록된 직급이 아닙니다.';
  end if;

  if new.hire_date is distinct from old.hire_date then
    if not app.can_edit_org_assignment() and not app.can_approve(old.id) then
      raise exception '입사일은 승인 처리 또는 조직도에서만 바꿀 수 있습니다.';
    end if;
    if new.hire_date is not null and (
      new.hire_date < date '1950-01-01'
      or new.hire_date > (timezone('Asia/Seoul', now()))::date
    ) then
      raise exception '입사일은 1950-01-01부터 오늘까지 입력할 수 있습니다.';
    end if;
  end if;

  if actor_is_admin then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.is_admin is distinct from old.is_admin
       or (
         (new.status is distinct from old.status
           or new.approved_by is distinct from old.approved_by
           or new.approved_at is distinct from old.approved_at)
         and not (
           old.status = 'rejected'
           and new.status = 'pending'
           and new.approved_by is null
           and new.approved_at is null
         )
       ) then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    if new.position is distinct from old.position
       or new.job_grade is distinct from old.job_grade then
      raise exception '본인은 직책·직급을 바꿀 수 없습니다.';
    end if;
    if new.department_id is distinct from old.department_id
       and not self_access_request then
      raise exception '본인은 소속을 바꿀 수 없습니다.';
    end if;
    if old.status in ('pending', 'rejected')
       and new.company_id is distinct from 'e0000000-0000-4000-8000-000000000001'::uuid then
      raise exception '신청 회사가 올바르지 않습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    if old.status = 'active' and old.name_confirmed_at is null then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        if new.name_confirmed_at is null or new.display_name is null then
          raise exception '본명과 확인을 함께 저장해야 합니다.';
        end if;
      end if;
    elsif old.status = 'active' then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        raise exception '본인은 확인한 본명을 바꿀 수 없습니다.';
      end if;
    end if;
    return new;
  end if;

  select app.can_approve(old.id) into actor_can_approve;
  if actor_can_approve then
    if new.is_admin is distinct from old.is_admin then
      raise exception '관리자 권한은 운영진만 지정할 수 있습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    return new;
  end if;

  if app.can_edit_org_assignment() then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.display_name is distinct from old.display_name
       or new.name_confirmed_at is distinct from old.name_confirmed_at
       or new.email is distinct from old.email
       or new.company_id is distinct from old.company_id
       or new.avatar_url is distinct from old.avatar_url
       or new.request_note is distinct from old.request_note
       or new.requested_at is distinct from old.requested_at then
      raise exception '운영지원팀은 부서와 직책·직급만 바꿀 수 있습니다.';
    end if;
    return new;
  end if;

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$
;
CREATE OR REPLACE FUNCTION app.save_company_notice(p_id uuid, p_slot text, p_department_id uuid, p_title text, p_body text, p_starts date, p_ends date, p_published boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  company uuid;
  actor_department uuid;
  actor_position text;
  notice_title text := btrim(p_title);
  notice_body text := btrim(p_body);
  saved uuid;
  audience uuid := p_department_id;
begin
  if actor is null then
    raise exception '로그인이 필요합니다.';
  end if;
  select p.company_id, p.department_id, p.position
    into company, actor_department, actor_position
  from public.profiles p
  where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_slot is distinct from 'my-attendance'
    and p_slot is distinct from 'company'
    and p_slot is distinct from 'department' then
    raise exception '게시 위치를 확인해 주세요.';
  end if;
  if p_slot = 'company' then
    audience := null;
  elsif p_slot = 'department' and audience is null then
    raise exception '부서 공지는 대상 부서를 선택해 주세요.';
  end if;
  if not (app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
    if p_slot is distinct from 'department'
      or actor_position is distinct from '팀장' and actor_position is distinct from '이사'
      or actor_department is null
      or audience is distinct from actor_department then
      raise exception '소속 부서의 팀장만 부서 공지를 등록할 수 있습니다.';
    end if;
    if p_id is not null and not exists (
      select 1 from public.company_notices n
      where n.id = p_id
        and n.company_id = company
        and n.slot = 'department'
        and n.department_id = actor_department
    ) then
      raise exception '수정할 부서 공지를 찾지 못했습니다.';
    end if;
  end if;
  if notice_title is null or char_length(notice_title) < 1 or char_length(notice_title) > 80 then
    raise exception '제목은 1자에서 80자까지 입력해 주세요.';
  end if;
  if notice_body is null or char_length(notice_body) < 1 or char_length(notice_body) > 4000 then
    raise exception '내용은 1자에서 4000자까지 입력해 주세요.';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception '종료일은 시작일보다 빠를 수 없습니다.';
  end if;
  if audience is not null and not exists (
    select 1 from public.departments d where d.id = audience and d.company_id = company and d.is_active
  ) then
    raise exception '같은 회사의 사용 중인 부서를 선택해 주세요.';
  end if;
  if p_id is null then
    insert into public.company_notices (
      company_id, slot, department_id, title, body, starts_on, ends_on, published, updated_by
    ) values (
      company, p_slot, audience, notice_title, notice_body, p_starts, p_ends, coalesce(p_published, true), actor
    ) returning id into saved;
  else
    update public.company_notices
    set slot = p_slot,
        department_id = audience,
        title = notice_title,
        body = notice_body,
        starts_on = p_starts,
        ends_on = p_ends,
        published = coalesce(p_published, true),
        updated_by = actor,
        updated_at = pg_catalog.now()
    where id = p_id and company_id = company
    returning id into saved;
    if saved is null then raise exception '수정할 공지를 찾지 못했습니다. 목록을 새로고침해 주세요.'; end if;
  end if;
  return saved;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.add_attendance_start_option(p_start time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := auth.uid(); company uuid;
begin
  if actor is null or not (app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
    raise exception '운영지원만 출근시간 목록을 바꿀 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_start is null or extract(second from p_start) <> 0 then
    raise exception '출근시간은 분 단위로 입력해 주세요.';
  end if;
  insert into public.attendance_start_options (company_id, start_time)
  values (company, p_start)
  on conflict (company_id, start_time) do nothing;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.save_company_lunch(p_start time without time zone, p_end time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := auth.uid(); company uuid;
begin
  if actor is null or not (app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
    raise exception '운영지원만 점심시간을 저장할 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception '점심 종료는 시작보다 뒤여야 합니다.';
  end if;
  if extract(second from p_start) <> 0 or extract(second from p_end) <> 0 then
    raise exception '점심시간은 분 단위로 입력해 주세요.';
  end if;
  insert into public.company_work_hours(company_id, lunch_start, lunch_end, updated_by)
  values (company, p_start, p_end, actor)
  on conflict (company_id) do update
  set lunch_start = excluded.lunch_start, lunch_end = excluded.lunch_end,
      updated_by = excluded.updated_by, updated_at = now();
end;
$function$
;
CREATE OR REPLACE FUNCTION app.guard_employee_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  company uuid;
  mine uuid;
begin
  select target.company_id into company
  from public.profiles as target
  where target.id = new.profile_id and target.status = 'active';
  if company is null then
    raise exception '같은 회사의 재직 직원만 기록할 수 있습니다.';
  end if;
  if current_setting('app.roster_import', true) is distinct from 'on' then
    select me.company_id into mine
    from public.profiles as me
    where me.id = (select auth.uid()) and me.status = 'active';
    if (select auth.uid()) is null
       or not ((select app.can_edit_org_assignment()) or app.basic_work_allowed('operations'))
       or company is distinct from mine then
      raise exception '운영지원만 같은 회사 근로자 명부를 저장할 수 있습니다.';
    end if;
  end if;
  new.company_id := company;
  new.updated_at := now();
  return new;
end;
$function$
;
create policy profiles_operations_read on public.profiles for select to authenticated using (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
create policy profiles_operations_update on public.profiles for update to authenticated using (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001') with check (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
create policy roster_operations_read on public.employee_roster for select to authenticated using (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
create policy roster_operations_insert on public.employee_roster for insert to authenticated with check (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
create policy roster_operations_update on public.employee_roster for update to authenticated using (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001') with check (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
create policy attendance_start_operations_read on public.attendance_start_settings for select to authenticated using (app.basic_work_allowed('operations') and company_id='e0000000-0000-4000-8000-000000000001');
