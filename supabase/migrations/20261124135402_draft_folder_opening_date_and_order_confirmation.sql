alter table public.seasons
  add column opening_date date,
  add column opening_date_confirmed boolean not null default false,
  add constraint seasons_opening_date_state check (
    (not opening_date_confirmed or opening_date is not null)
    and (opening_date is null or (isfinite(opening_date) and code <> 'UNASSIGNED'))
  );

-- The new browser flow checks the prerequisites under the same lock as team work.
-- Keep the existing team-work API available during the web rollout.
create function app.confirm_draft_order_quantity(p_draft_id uuid, p_payload jsonb, p_revision uuid)
returns setof public.draft_team_work
language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.product_drafts%rowtype;
  v_quote app.draft_price_requests%rowtype;
  v_manual jsonb;
  v_amounts jsonb;
  v_color_count integer;
begin
  if auth.uid() is null or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  select * into v_draft from public.product_drafts where id = p_draft_id for no key update;
  if not found or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  if v_draft.specs->'nameConfirmed' is distinct from 'true'::jsonb
    or (nullif(btrim(v_draft.name_en), '') is null and nullif(btrim(v_draft.name_ko), '') is null) then
    raise exception '상품명을 먼저 확정해 주세요.';
  end if;
  select count(*)::integer into v_color_count from public.draft_colors where draft_id = p_draft_id;
  if v_color_count = 0
    or exists (
      select 1 from public.draft_colors c
      cross join lateral (select
        btrim(coalesce(v_draft.specs->'colorNames'->c.id::text->>'nameEn', '')) as en,
        btrim(coalesce(v_draft.specs->'colorNames'->c.id::text->>'nameKo', '')) as ko,
        btrim(coalesce(c.name, '')) collate "C" as legacy
      ) names
      where c.draft_id = p_draft_id and (
        (names.en = '' and (names.legacy in ('', names.ko) or names.legacy ~ '[가-힣ㄱ-ㅎㅏ-ㅣᄀ-ᇿ]'))
        or (names.ko = '' and (names.legacy in ('', names.en) or names.legacy !~ '[가-힣ㄱ-ㅎㅏ-ㅣᄀ-ᇿ]'))
        or not coalesce(case v_draft.specs->'colorImageChoices'->>c.id::text
          when 'None' then true
          when 'Image' then nullif(v_draft.specs->'colorPhotoUrls'->>c.id::text, '') is not null
        end, false)
      )
    ) then
    raise exception '모든 컬러의 영문·한글명과 이미지 설정을 완료해 주세요.';
  end if;
  select * into v_quote from app.draft_price_requests
    where company_id = v_draft.company_id and draft_id = p_draft_id order by round desc limit 1;
  v_manual := v_draft.specs->'manualPrice';
  if jsonb_typeof(v_manual->'amounts') = 'object' and v_manual->>'savedAt' is not null
    and (v_quote.id is null or (v_manual->>'savedAt')::timestamptz >= v_quote.requested_at) then
    v_amounts := v_manual->'amounts';
  elsif v_quote.answered_at is not null and v_draft.specs->>'confirmedPriceRequestId' = v_quote.id::text then
    v_amounts := v_quote.amounts;
  end if;
  if v_amounts is null or (select count(*) from jsonb_object_keys(v_amounts)) <> v_color_count or exists (
    select 1 from public.draft_colors where draft_id = p_draft_id
      and jsonb_typeof(v_amounts->id::text) is distinct from 'number'
  ) then
    raise exception '모든 컬러의 단가를 먼저 확정해 주세요.';
  end if;
  if v_draft.brand_id is null then
    raise exception '브랜드를 먼저 지정해 주세요.';
  end if;
  perform 1 from public.seasons
    where id = v_draft.season_id and brand_id = v_draft.brand_id and code <> 'UNASSIGNED'
      and opening_date is not null and opening_date_confirmed
    for share;
  if not found then
    raise exception '같은 브랜드의 출시 폴더에 넣고 오픈 예정일을 확정해 주세요.';
  end if;

  return query select * from app.save_draft_team_work(p_draft_id, 'md-quantity', p_payload, true, p_revision);
end
$$;

create function public.confirm_draft_order_quantity(p_draft_id uuid, p_payload jsonb, p_revision uuid)
returns setof public.draft_team_work
language sql security invoker set search_path = '' as $$
  select * from app.confirm_draft_order_quantity(p_draft_id, p_payload, p_revision)
$$;

revoke all on function app.confirm_draft_order_quantity(uuid, jsonb, uuid),
  public.confirm_draft_order_quantity(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function app.confirm_draft_order_quantity(uuid, jsonb, uuid),
  public.confirm_draft_order_quantity(uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
