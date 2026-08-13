-- 사은품 선착순 한도 방식:
-- 기존 M번호별 한도와 여러 M번호가 공유하는 전체 사은품 합계 한도를 함께 지원한다.

alter table public.invoice_prefix_requests
  add column if not exists first_come_limit_mode text not null default 'per_style',
  add column if not exists first_come_total_limit integer;

alter table public.invoice_prefix_requests
  drop constraint if exists invoice_prefix_requests_first_come_limit_check;

alter table public.invoice_prefix_requests
  add constraint invoice_prefix_requests_first_come_limit_check
  check (
    (
      first_come_limit_mode = 'per_style'
      and first_come_total_limit is null
    )
    or (
      first_come_limit_mode = 'shared_total'
      and first_come_total_limit is not null
      and first_come_total_limit > 0
    )
  );

comment on column public.invoice_prefix_requests.first_come_limit_mode is
  'per_style: M번호별 한도, shared_total: 요청 건의 모든 M번호가 공유하는 실제 사은품 합계 한도.';
comment on column public.invoice_prefix_requests.first_come_total_limit is
  'shared_total일 때 요청 건 전체에서 나갈 수 있는 실제 사은품 총수량.';

-- 배정 이력이 생긴 뒤에는 행사 구조·한도 방식을 바꾸거나 한도를 줄이지 않는다.
create or replace function app.guard_invoice_gift_request_after_allocation()
returns trigger
language plpgsql
security invoker
set search_path = public, app
as $$
begin
  if not exists (
    select 1
    from public.invoice_gift_allocations a
    where a.request_id = old.id
  ) then
    return new;
  end if;

  if new.brand_id is distinct from old.brand_id
    or new.task_no is distinct from old.task_no
    or new.mall_name is distinct from old.mall_name
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.count_basis is distinct from old.count_basis
    or new.merge_basis is distinct from old.merge_basis
    or new.uses_first_come is distinct from old.uses_first_come
    or new.first_come_limit_mode is distinct from old.first_come_limit_mode
  then
    raise exception
      '배정 이력이 있는 사은품 요청은 제목·메모·활성 상태와 한도 증가만 변경할 수 있습니다.';
  end if;

  if old.first_come_limit_mode = 'shared_total'
    and new.first_come_total_limit < old.first_come_total_limit
  then
    raise exception '배정 이력이 있는 전체 합계 한도는 줄일 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_prefix_requests_guard_after_allocation
  on public.invoice_prefix_requests;
create trigger invoice_prefix_requests_guard_after_allocation
before update on public.invoice_prefix_requests
for each row execute function app.guard_invoice_gift_request_after_allocation();

create or replace function app.guard_invoice_gift_quota_after_allocation()
returns trigger
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_request_id uuid;
begin
  v_request_id := case
    when tg_op = 'DELETE' then old.request_id
    else new.request_id
  end;

  if not exists (
    select 1
    from public.invoice_gift_allocations a
    where a.request_id = v_request_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    raise exception
      '배정 이력이 있는 요청의 M번호별 한도 구성은 바꿀 수 없습니다.';
  end if;

  if new.brand_id is distinct from old.brand_id
    or new.request_id is distinct from old.request_id
    or new.style_id is distinct from old.style_id
  then
    raise exception
      '배정 이력이 있는 요청의 M번호별 한도 구성은 바꿀 수 없습니다.';
  end if;

  if new.quantity_limit < old.quantity_limit then
    raise exception '배정 이력이 있는 M번호별 한도는 줄일 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_gift_quotas_guard_after_allocation
  on public.invoice_gift_quotas;
create trigger invoice_gift_quotas_guard_after_allocation
before insert or update or delete on public.invoice_gift_quotas
for each row execute function app.guard_invoice_gift_quota_after_allocation();

-- 요청 행 잠금으로 요청별 동시 확정을 직렬화한다.
-- atomic_group_key가 같은 후보는 고정 사은품 한 세트이며 전부 또는 전혀 배정하지 않는다.
create or replace function public.confirm_invoice_gift_allocations(
  p_brand_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
  if not app.can_edit_brand(p_brand_id) then
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

  -- 여러 요청을 한 번에 확정해도 UUID 순서로 잠가 교착을 피한다.
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

    -- 한도 검증을 그룹 전체에 끝낸 뒤에만 신규 행을 넣는다.
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
$$;

comment on function public.confirm_invoice_gift_allocations(uuid, jsonb) is
  'M번호별 또는 전체 합계 한도 안에서 atomic_group_key 단위로 선착순 사은품을 원자 확정한다.';

grant execute on function public.confirm_invoice_gift_allocations(uuid, jsonb)
to authenticated;
