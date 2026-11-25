alter table public.brands add column style_number_prefix text
  constraint brands_style_number_prefix_format check (style_number_prefix collate "C" ~ '^[A-Z]{1,12}$');
create unique index brands_company_style_number_prefix
  on public.brands (company_id, style_number_prefix) where style_number_prefix is not null;
update public.brands set style_number_prefix = 'M' where slug = 'masmarulez';

alter table public.draft_team_work add column issued_style_numbers jsonb not null default '{}'::jsonb
  check (jsonb_typeof(issued_style_numbers) = 'object'
    and (section = 'md-quantity' or issued_style_numbers = '{}'::jsonb));

-- Refresh the existing composite-returning routines after extending the row type.
do $$
begin
  execute pg_get_functiondef('app.save_draft_team_work(uuid,text,jsonb,boolean,uuid)'::regprocedure);
  execute pg_get_functiondef('public.save_draft_team_work(uuid,text,jsonb,boolean,uuid)'::regprocedure);
  execute pg_get_functiondef('app.confirm_draft_order_quantity(uuid,jsonb,uuid)'::regprocedure);
  execute pg_get_functiondef('public.confirm_draft_order_quantity(uuid,jsonb,uuid)'::regprocedure);
end
$$;

create function app.draft_order_style_number_preview(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_brand uuid;
  v_prefix text;
  v_numbers jsonb;
begin
  if auth.uid() is null or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  select d.brand_id, b.style_number_prefix into v_brand, v_prefix
  from public.product_drafts d left join public.brands b on b.id = d.brand_id and b.company_id = d.company_id
  where d.id = p_draft_id;

  with colors as (
    select c.id, c.sort_order, w.issued_style_numbers->c.id::text->>'number' as issued
    from public.draft_colors c
    left join public.draft_team_work w on w.draft_id = c.draft_id and w.section = 'md-quantity'
    where c.draft_id = p_draft_id
  ), pending as (
    select id, row_number() over (order by sort_order, id) as position from colors where issued is null
  ), occupied as (
    select substring(upper(regexp_replace(s.style_no, '\s+', '', 'g')) from ('^' || v_prefix || '([0-9]{1,5})$'))::integer as number
    from public.styles s where s.brand_id = v_brand
    union
    select substring(entry.value->>'number' from ('^' || v_prefix || '([0-9]{4})$'))::integer
    from public.product_drafts d join public.draft_team_work w on w.draft_id = d.id and w.section = 'md-quantity'
    cross join lateral jsonb_each(w.issued_style_numbers) entry
    where d.brand_id = v_brand
  ), candidates as (
    select free.number, row_number() over (order by free.number) as position
    from generate_series(1, 9999) as free(number)
    where v_prefix is not null and not exists (select 1 from occupied used where used.number = free.number)
    order by free.number limit (select count(*) from pending)
  )
  select coalesce(jsonb_object_agg(id, number), '{}'::jsonb) into v_numbers
  from (
    select id, issued as number from colors where issued is not null
    union all
    select pending.id, v_prefix || lpad(candidates.number::text, 4, '0')
    from pending join candidates using (position)
  ) numbered;
  return jsonb_build_object('prefix', v_prefix, 'numbers', v_numbers);
end
$$;

create function app.confirm_draft_order_with_style_numbers(p_draft_id uuid, p_payload jsonb, p_revision uuid, p_style_numbers jsonb)
returns setof public.draft_team_work language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.product_drafts%rowtype;
  v_order public.draft_team_work%rowtype;
  v_preview jsonb;
  v_issued jsonb;
  v_color record;
  v_style_id uuid;
  v_number text;
begin
  -- Reuse the existing permission, prerequisite and revision checks and draft row lock.
  select * into strict v_order from app.confirm_draft_order_quantity(p_draft_id, p_payload, p_revision);
  select * into strict v_draft from public.product_drafts where id = p_draft_id;
  -- Serialize issuance and prefix changes for this brand. The SKU unique index protects against other imports.
  perform 1 from public.brands where id = v_draft.brand_id and company_id = v_draft.company_id for no key update;
  v_preview := app.draft_order_style_number_preview(p_draft_id);
  if (select count(*) from jsonb_object_keys(v_preview->'numbers')) <> (select count(*) from public.draft_colors where draft_id = p_draft_id) then
    if v_preview->>'prefix' is null then
      raise exception '브랜드 관리에서 품번 접두어를 설정해 주세요.';
    end if;
    raise exception '이 브랜드에 발급할 수 있는 네 자리 품번이 부족합니다.';
  end if;
  if p_style_numbers is distinct from v_preview->'numbers' then
    raise exception '품번 후보가 변경됐습니다. 수량 확정 창을 다시 열어 확인해 주세요.';
  end if;

  v_issued := v_order.issued_style_numbers;
  for v_color in
    select c.id,
      coalesce(nullif(btrim(v_draft.specs->'colorNames'->c.id::text->>'nameKo'), ''), nullif(btrim(c.name), ''),
        v_draft.specs->'colorNames'->c.id::text->>'nameEn') as name
    from public.draft_colors c where c.draft_id = p_draft_id and not (v_issued ? c.id::text)
  loop
    v_number := p_style_numbers->>v_color.id::text;
    if coalesce(nullif(p_payload->'quantities'->>v_color.id::text, '')::bigint, 0) > 2147483647 then
      raise exception '전체 상품에 등록할 수 있는 발주 수량 범위를 초과했습니다.';
    end if;
    insert into public.styles (brand_id, season_id, style_no, name, colors, planned_qty, retail_price, status, planner)
    values (v_draft.brand_id, v_draft.season_id, v_number,
      concat_ws(' ', coalesce(nullif(btrim(v_draft.name_ko), ''), nullif(btrim(v_draft.name_en), ''), v_draft.draft_no), v_color.name),
      jsonb_build_array(v_color.name), nullif(p_payload->'quantities'->>v_color.id::text, '')::integer,
      v_draft.retail_price, 'confirmed', nullif(btrim(v_draft.owner), ''))
    on conflict (brand_id, style_no) do nothing returning id into v_style_id;
    if v_style_id is null then
      raise exception '품번 후보가 변경됐습니다. 수량 확정 창을 다시 열어 확인해 주세요.';
    end if;
    v_issued := v_issued || jsonb_build_object(v_color.id, jsonb_build_object('number', v_number, 'style_id', v_style_id));
  end loop;

  return query update public.draft_team_work w set issued_style_numbers = v_issued
  where w.draft_id = p_draft_id and w.section = 'md-quantity' returning w.*;
end
$$;

-- Issued catalog SKUs remain linked to the brand that received them.
create function app.guard_draft_issued_style_brand() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.draft_team_work where draft_id = old.id and section = 'md-quantity'
    and issued_style_numbers <> '{}'::jsonb) then
    raise exception '품번이 등록된 기획안은 브랜드를 변경할 수 없습니다.';
  end if;
  return new;
end
$$;
create trigger guard_draft_issued_style_brand before update of brand_id on public.product_drafts
for each row when (old.brand_id is distinct from new.brand_id) execute function app.guard_draft_issued_style_brand();

create function public.draft_order_style_number_preview(p_draft_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.draft_order_style_number_preview(p_draft_id);
$$;
create function public.confirm_draft_order_quantity(p_draft_id uuid, p_payload jsonb, p_revision uuid, p_style_numbers jsonb)
returns setof public.draft_team_work language sql security invoker set search_path = '' as $$
  select * from app.confirm_draft_order_with_style_numbers(p_draft_id, p_payload, p_revision, p_style_numbers);
$$;

revoke all on function app.draft_order_style_number_preview(uuid), app.confirm_draft_order_with_style_numbers(uuid,jsonb,uuid,jsonb),
  app.guard_draft_issued_style_brand(), public.draft_order_style_number_preview(uuid),
  public.confirm_draft_order_quantity(uuid,jsonb,uuid,jsonb) from public, anon, authenticated;
grant execute on function app.draft_order_style_number_preview(uuid), app.confirm_draft_order_with_style_numbers(uuid,jsonb,uuid,jsonb),
  public.draft_order_style_number_preview(uuid), public.confirm_draft_order_quantity(uuid,jsonb,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
