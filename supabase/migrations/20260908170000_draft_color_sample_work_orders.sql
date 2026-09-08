-- 컬러 샘플도 컬러마다 작업 지시서를 따로 둔다.

alter table public.draft_colors
  add column if not exists sample_work_order_url text,
  add column if not exists sample_work_order_name text not null default '',
  add column if not exists sample_work_order_shipped boolean not null default false,
  add column if not exists sample_work_order_shipped_at timestamptz;

comment on column public.draft_colors.sample_work_order_url is
  '이 컬러 샘플 작업 지시서. data URL';
comment on column public.draft_colors.sample_work_order_name is
  '이 컬러 샘플 작업 지시서 파일명';
comment on column public.draft_colors.sample_work_order_shipped is
  '중국팀이 이 컬러 샘플을 발송했는지';

create or replace function public.save_product_draft(
  p_company_id uuid,
  p_brand_id uuid,
  p_id uuid,
  p_payload jsonb,
  p_colors jsonb,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
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
  if not app.can_edit_company(p_company_id) then
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
$function$;

grant execute on function public.save_product_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated, postgres;

notify pgrst, 'reload schema';
