-- 송장 백업도 최근 작업 이력을 남기고, 파일명·작업자·시각을 고치거나
-- 이력과 같은 파일 지문의 invoice 출고 원장을 함께 지울 수 있게 한다.
-- 재고 RPC는 호출하지 않는다.

create or replace function public.record_invoice_work_backup(
  p_brand_id uuid,
  p_file_fingerprint text,
  p_source_file_name text,
  p_worker_label text,
  p_source_row_count integer,
  p_source_order_count integer,
  p_sites jsonb
) returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $function$
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
  if not app.can_edit_brand(p_brand_id) then
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

  return v_run_id;
end;
$function$;

comment on function public.record_invoice_work_backup(
  uuid, text, text, text, integer, integer, jsonb
) is
  '송장 백업 시 작업 이력을 upsert한다. 이미 있는 CJ 출력 수치는 유지한다.';

revoke all on function public.record_invoice_work_backup(
  uuid, text, text, text, integer, integer, jsonb
) from public;

grant execute on function public.record_invoice_work_backup(
  uuid, text, text, text, integer, integer, jsonb
) to authenticated;

create or replace function public.update_invoice_work_run(
  p_brand_id uuid,
  p_run_id uuid,
  p_source_file_name text,
  p_worker_label text,
  p_completed_at timestamptz
) returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_locked integer;
begin
  if p_brand_id is null or p_run_id is null then
    raise exception '작업 이력이 올바르지 않습니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
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
$function$;

comment on function public.update_invoice_work_run(
  uuid, uuid, text, text, timestamptz
) is
  '송장 작업 이력의 파일명·작업자·작업 시각만 고친다.';

revoke all on function public.update_invoice_work_run(
  uuid, uuid, text, text, timestamptz
) from public;

grant execute on function public.update_invoice_work_run(
  uuid, uuid, text, text, timestamptz
) to authenticated;

create or replace function public.delete_invoice_work_run(
  p_brand_id uuid,
  p_run_id uuid
) returns integer
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_fingerprint text;
  v_removed integer := 0;
begin
  if p_brand_id is null or p_run_id is null then
    raise exception '작업 이력이 올바르지 않습니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 출고 이력을 삭제할 권한이 없습니다.';
  end if;

  select file_fingerprint
    into v_fingerprint
    from public.invoice_work_runs
   where brand_id = p_brand_id
     and id = p_run_id
   for update;

  if v_fingerprint is null then
    raise exception '작업 이력을 찾지 못했습니다.';
  end if;

  delete from public.outbound_shipments
   where brand_id = p_brand_id
     and source = 'invoice'
     and source_ref = v_fingerprint;

  get diagnostics v_removed = row_count;

  delete from public.invoice_work_runs
   where brand_id = p_brand_id
     and id = p_run_id;

  return v_removed;
end;
$function$;

comment on function public.delete_invoice_work_run(uuid, uuid) is
  '송장 작업 이력과 같은 파일 지문의 invoice 출고 원장을 함께 지운다. 재고는 건드리지 않는다.';

revoke all on function public.delete_invoice_work_run(uuid, uuid) from public;

grant execute on function public.delete_invoice_work_run(uuid, uuid)
to authenticated;
