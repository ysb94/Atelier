-- Keep quotes separate from the draft's target cost and other draft edits.
create table app.draft_price_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  draft_id uuid not null,
  round integer not null check (round > 0),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  colors jsonb not null check (jsonb_typeof(colors) = 'array' and jsonb_array_length(colors) > 0),
  photos jsonb not null,
  amounts jsonb,
  answered_by uuid,
  answered_at timestamptz,
  foreign key (company_id, draft_id) references public.product_drafts (company_id, id) on delete cascade,
  unique (company_id, draft_id, round),
  check ((answered_at is null and answered_by is null and amounts is null)
      or (answered_at is not null and answered_by is not null and jsonb_typeof(amounts) = 'object' and amounts is not null))
);
create unique index draft_price_requests_one_pending on app.draft_price_requests (draft_id) where answered_at is null;
alter table app.draft_price_requests enable row level security;
revoke all on table app.draft_price_requests from public, anon, authenticated;

create function app.draft_price_summary(p_request app.draft_price_requests, p_draft_no text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_request.id, 'draftId', p_request.draft_id, 'draftNo', p_draft_no, 'round', p_request.round,
    'requestedAt', p_request.requested_at, 'answeredAt', p_request.answered_at,
    'colors', p_request.colors, 'amounts', p_request.amounts
  )
$$;

create function app.list_draft_price_requests(p_scope text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
begin
  if v_actor is null or v_company is null
    or (p_scope = 'china' and app.china_work_screen_role() is distinct from 'manager') then
    raise exception '단가요청 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('planning', 'china') then
    raise exception '단가요청 조회 범위를 확인해 주세요.' using errcode = '22023';
  end if;

  -- One pending and the most recent reply per draft. Photos are fetched individually.
  return coalesce((
    select jsonb_agg(app.draft_price_summary(r, d.draft_no)
      order by (r.round <> 1), (r.answered_at is not null), r.requested_at, r.id)
    from (
      select distinct on (draft_id, (answered_at is not null)) id
      from app.draft_price_requests
      where company_id = v_company
      order by draft_id, (answered_at is not null), round desc
    ) recent
    join app.draft_price_requests r on r.id = recent.id
    join public.product_drafts d on d.company_id = r.company_id and d.id = r.draft_id
    where p_scope = 'china' or d.created_by = v_actor or app.basic_work_allowed('planning', d.brand_id)
  ), '[]'::jsonb);
end $$;

create function app.request_draft_price(p_draft uuid, p_revision timestamptz, p_previous uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_draft public.product_drafts;
  v_previous app.draft_price_requests;
  v_saved app.draft_price_requests;
  v_color record;
  v_choice text;
  v_photo text;
  v_colors jsonb := '[]';
  v_photos jsonb := '{}';
begin
  if v_actor is null or v_company is null or not app.draft_write_allowed(p_draft) then
    raise exception '이 기획안의 단가를 요청할 권한이 없습니다.' using errcode = '42501';
  end if;
  -- Serialize requests for one draft with its existing save transaction.
  select * into v_draft from public.product_drafts where company_id = v_company and id = p_draft for update;
  if not found then
    raise exception '이 기획안을 찾을 수 없습니다.' using errcode = '42501';
  end if;
  select * into v_previous from app.draft_price_requests
    where company_id = v_company and draft_id = p_draft order by round desc limit 1;
  if v_previous.id is not null and v_previous.answered_at is null then
    return app.draft_price_summary(v_previous, v_draft.draft_no);
  end if;
  if v_previous.id is distinct from p_previous or v_draft.updated_at is distinct from p_revision then
    raise exception '기획안 또는 단가요청이 변경되었습니다.' using errcode = '40001';
  end if;

  for v_color in
    select id, name from public.draft_colors where company_id = v_company and draft_id = p_draft order by sort_order, id
  loop
    v_choice := v_draft.specs -> 'colorImageChoices' ->> v_color.id::text;
    v_photo := null;
    if v_choice is distinct from 'None' then
      v_photo := v_draft.specs -> 'colorPhotoUrls' ->> v_color.id::text;
      if v_choice is distinct from 'Image' or v_photo is null or length(v_photo) > 98304
        or v_photo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
        raise exception '컬러마다 사진을 첨부하거나 None을 선택해 저장해 주세요.' using errcode = '22023';
      end if;
      v_photos := v_photos || jsonb_build_object(v_color.id::text, v_photo);
    end if;
    v_colors := v_colors || jsonb_build_array(jsonb_build_object(
      'id', v_color.id, 'name', coalesce(nullif(btrim(v_color.name), ''), (jsonb_array_length(v_colors) + 1)::text || '번 컬러'),
      'hasPhoto', v_photo is not null
    ));
  end loop;
  if jsonb_array_length(v_colors) = 0 then
    raise exception '컬러를 먼저 추가해 주세요.' using errcode = '22023';
  end if;

  insert into app.draft_price_requests (company_id, draft_id, round, requested_by, colors, photos)
    values (v_company, p_draft, coalesce(v_previous.round, 0) + 1, v_actor, v_colors, v_photos)
    returning * into v_saved;
  return app.draft_price_summary(v_saved, v_draft.draft_no);
end $$;

create function app.reply_draft_price(p_request uuid, p_amounts jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_request app.draft_price_requests;
  v_draft_no text;
  v_color jsonb;
  v_amount numeric;
begin
  if v_actor is null or v_company is null or app.china_work_screen_role() is distinct from 'manager' then
    raise exception '단가를 전송할 권한이 없습니다.' using errcode = '42501';
  end if;
  select * into v_request from app.draft_price_requests where company_id = v_company and id = p_request for update;
  if not found then
    raise exception '이 단가요청을 찾을 수 없습니다.' using errcode = '42501';
  end if;
  if v_request.answered_at is not null then
    if v_request.amounts is distinct from p_amounts then
      raise exception '이미 단가가 전송되었습니다.' using errcode = '40001';
    end if;
  else
    if jsonb_typeof(p_amounts) is distinct from 'object' then
      raise exception '요청된 컬러의 단가를 모두 입력해 주세요.' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_object_keys(p_amounts)) <> jsonb_array_length(v_request.colors) then
      raise exception '요청된 컬러의 단가를 모두 입력해 주세요.' using errcode = '22023';
    end if;
    for v_color in select value from jsonb_array_elements(v_request.colors) loop
      if jsonb_typeof(p_amounts -> (v_color ->> 'id')) is distinct from 'number' then
        raise exception '요청된 컬러의 단가를 모두 입력해 주세요.' using errcode = '22023';
      end if;
      v_amount := (p_amounts ->> (v_color ->> 'id'))::numeric;
      if v_amount < 0 or v_amount > 99999999.99 or v_amount <> trunc(v_amount, 2) then
        raise exception '단가는 0~99,999,999.99위안, 소수점 둘째 자리까지 입력해 주세요.' using errcode = '22023';
      end if;
    end loop;
    update app.draft_price_requests set amounts = p_amounts, answered_at = now(), answered_by = v_actor
      where id = p_request returning * into v_request;
  end if;

  select draft_no into v_draft_no from public.product_drafts where company_id = v_company and id = v_request.draft_id;
  return app.draft_price_summary(v_request, v_draft_no);
end $$;

create function app.get_draft_price_photo(p_request uuid, p_color text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or app.china_work_screen_role() is distinct from 'manager' then
    raise exception '컬러 사진을 볼 권한이 없습니다.' using errcode = '42501';
  end if;
  return (select photos ->> p_color from app.draft_price_requests where company_id = app.permission_company_id() and id = p_request);
end $$;

create function public.list_draft_price_requests(p_scope text) returns jsonb
language sql stable security invoker set search_path = '' as $$ select app.list_draft_price_requests(p_scope) $$;
create function public.request_draft_price(p_draft uuid, p_revision timestamptz, p_previous uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select app.request_draft_price(p_draft, p_revision, p_previous) $$;
create function public.reply_draft_price(p_request uuid, p_amounts jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select app.reply_draft_price(p_request, p_amounts) $$;
create function public.get_draft_price_photo(p_request uuid, p_color text) returns text
language sql stable security invoker set search_path = '' as $$ select app.get_draft_price_photo(p_request, p_color) $$;

revoke all on function app.draft_price_summary(app.draft_price_requests, text),
  app.list_draft_price_requests(text), app.request_draft_price(uuid, timestamptz, uuid),
  app.reply_draft_price(uuid, jsonb), app.get_draft_price_photo(uuid, text),
  public.list_draft_price_requests(text), public.request_draft_price(uuid, timestamptz, uuid),
  public.reply_draft_price(uuid, jsonb), public.get_draft_price_photo(uuid, text) from public, anon, authenticated;
grant execute on function app.list_draft_price_requests(text), app.request_draft_price(uuid, timestamptz, uuid),
  app.reply_draft_price(uuid, jsonb), app.get_draft_price_photo(uuid, text),
  public.list_draft_price_requests(text), public.request_draft_price(uuid, timestamptz, uuid),
  public.reply_draft_price(uuid, jsonb), public.get_draft_price_photo(uuid, text) to authenticated;

notify pgrst, 'reload schema';
