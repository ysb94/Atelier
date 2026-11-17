alter table app.atelier_stock_sheet_jobs
  add column repair_differences jsonb,
  add column repair_observed_at timestamptz;

-- Persist the observation before changing Sheets so a lost write response
-- cannot turn an automatically repaired row into an ordinary success.
create function public.record_atelier_stock_sheet_repair(
  p_brand_id uuid, p_job_id uuid, p_lease uuid, p_differences jsonb
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_lease is null or jsonb_typeof(p_differences) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_differences) not between 1 and 16
    or octet_length(p_differences::text) > 28000 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  update app.atelier_stock_sheet_jobs j
  set repair_differences = p_differences, repair_observed_at = clock_timestamp()
  where j.id = p_job_id and j.brand_id = p_brand_id and j.lease_token = p_lease
    and j.completed_at is null and j.available_at > clock_timestamp()
    and not exists (
      select 1 from jsonb_array_elements(p_differences) d
      where jsonb_typeof(d) <> 'object'
        or not coalesce(d->>'id' = any(j.row_ids), false)
        or not coalesce(d->>'field' in ('M번호','품명','자리','입고일','박스당 수량','박스 수','메모','박스 QR'), false)
        or not (d ?& array['expected','actual','target'])
        or exists (
          select 1 from unnest(array['expected','actual','target']) k
          where jsonb_typeof(d->k) not in ('string','null') or length(d->>k) > 120
        )
    );
  return found;
end;
$$;

create function public.list_atelier_stock_sheet_activity(p_brand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  -- The existing function checks the warehouse review permission for the brand.
  v_conflicts jsonb := public.list_atelier_stock_sheet_conflicts(p_brand_id);
begin
  return jsonb_build_object(
    'conflicts', v_conflicts,
    'repairs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.completed_at desc)
      from (
        select id, row_ids, completed_at, repair_observed_at, repair_differences
        from app.atelier_stock_sheet_jobs
        where brand_id = p_brand_id and repair_observed_at is not null
          and completed_at >= now() - interval '7 days'
        order by completed_at desc, id
        limit 20
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_atelier_stock_sheet_repair(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_atelier_stock_sheet_repair(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.list_atelier_stock_sheet_activity(uuid) from public,anon,authenticated;
grant execute on function public.list_atelier_stock_sheet_activity(uuid) to authenticated;
