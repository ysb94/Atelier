-- 대량출고 건 삭제 시 같은 Job의 임시 백업 출고 원장도 함께 지운다.
-- 재고 RPC는 호출하지 않는다.

create or replace function public.delete_bulk_outbound_job(
  p_brand_id uuid,
  p_job_id uuid,
  p_assignee text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_assignee text;
  v_removed integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  select assignee
    into v_assignee
  from public.bulk_outbound_jobs
  where id = p_job_id
    and brand_id = p_brand_id;

  if not found then
    raise exception '대량출고 작업을 찾지 못했습니다.';
  end if;

  if coalesce(v_assignee, '') is distinct from coalesce(p_assignee, '') then
    raise exception '본인이 만든 건만 삭제할 수 있습니다.';
  end if;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = p_job_id::text;

  get diagnostics v_removed = row_count;

  delete from public.bulk_outbound_jobs
  where brand_id = p_brand_id
    and id = p_job_id;

  return v_removed;
end;
$function$;

grant execute on function public.delete_bulk_outbound_job(uuid, uuid, text)
to authenticated;
