-- Enable only where the coalescing Atelier sheet worker is already active.
-- Existing prepared operations retain their identity and finish through the new RPC.
set local lock_timeout='3s';
do $enable$
declare v_brand uuid;
begin
  select id into strict v_brand from public.brands where slug='masmarulez';
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || v_brand::text,0));
  if not app.atelier_stock_sheet_enabled(v_brand) then
    raise exception 'Enable Atelier stock sheet writeback first';
  end if;
  if exists(select 1 from app.finder_warehouse_sheet_exports where brand_id=v_brand and sheet_synced_at is null)
    or exists(select 1 from app.warehouse_qr_audit_sheet_exports where brand_id=v_brand and sheet_synced_at is null and not atelier_managed)
    or exists(select 1 from app.masma_finder_inbound_sheet where brand_id=v_brand and sheet_row_id is null) then
    raise exception 'Finish legacy sheet deliveries before enabling Finder DB-first';
  end if;
  insert into app.finder_warehouse_db_settings(brand_id) values(v_brand) on conflict do nothing;
end;
$enable$;
