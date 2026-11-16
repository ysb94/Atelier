-- A confirmation must contain the values read back from the actual sheet row.
create or replace function public.confirm_warehouse_stock_condition_exports(
  p_brand_id uuid, p_confirmed jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  update app.warehouse_stock_condition_exports as e set sheet_synced_at = clock_timestamp()
  from jsonb_to_recordset(p_confirmed) as observed(request_id uuid, row_id text, observed_values jsonb)
  where e.brand_id = p_brand_id and e.sheet_synced_at is null
    and e.request_id = observed.request_id and e.external_row_id = observed.row_id
    and btrim(e.sheet_values->>'number') = observed.observed_values->>'number'
    and btrim(e.sheet_values->>'productName') = observed.observed_values->>'productName'
    and upper(btrim(coalesce(e.sheet_values->>'boxQr', ''))) = upper(observed.observed_values->>'boxQr')
    and (
      -- A status change edits B/C only. Its location and QR must still identify the same box.
      (e.before_values is not null and not (e.before_values ? 'receivedOn')
        and regexp_replace(btrim(e.sheet_values->>'place'), '//[[:space:]]*$', '') =
          regexp_replace(observed.observed_values->>'place', '//[[:space:]]*$', ''))
      or
      -- A new row or correction must match every managed field, including blanks.
      ((e.before_values is null or e.before_values ? 'receivedOn')
        and btrim(e.sheet_values->>'place') = observed.observed_values->>'place'
        and btrim(coalesce(e.sheet_values->>'receivedOn', '')) = observed.observed_values->>'receivedOn'
        and replace(btrim(coalesce(e.sheet_values->>'units', '')), ',', '') =
          replace(observed.observed_values->>'units', ',', '')
        and replace(btrim(coalesce(e.sheet_values->>'boxes', '')), ',', '') =
          replace(observed.observed_values->>'boxes', ',', '')
        and (
          btrim(coalesce(e.sheet_values->>'note', '')) = observed.observed_values->>'note'
          or (coalesce((e.sheet_values->>'openedUnits')::integer, 0) > 0
            and observed.observed_values->>'note' = concat_ws(' · ',
              '개봉 잔량 ' || (e.sheet_values->>'openedUnits') || '개',
              nullif(btrim(e.sheet_values->>'note'), '')))
        ))
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_warehouse_stock_condition_exports(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_warehouse_stock_condition_exports(uuid,jsonb) to service_role;
