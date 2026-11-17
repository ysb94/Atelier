-- An already-empty QR audit has no stock transition to synchronize.
do $migration$
declare v_def text; v_old text := '    insert into app.warehouse_qr_audit_sheet_exports (id,brand_id,whole_place,before_rows,after_rows,atelier_review)';
begin
  v_def := pg_get_functiondef('app.finder_warehouse_qr_audit(uuid,text,jsonb)'::regprocedure);
  if strpos(v_def,v_old)=0 then raise exception 'Unexpected QR audit definition'; end if;
  execute replace(v_def,v_old,$replacement$
    if v_before='[]'::jsonb and v_after='[]'::jsonb then
      return v_result || jsonb_build_object('sheetPending',false);
    end if;
    insert into app.warehouse_qr_audit_sheet_exports (id,brand_id,whole_place,before_rows,after_rows,atelier_review)$replacement$);
end;
$migration$;
