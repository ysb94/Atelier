-- Public compatibility RPCs are SECURITY INVOKER. Keep execution permission
-- on their authenticated app entry points while all completion helpers stay private.
grant execute on function app.finder_warehouse_placement(uuid,text,jsonb),
  app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb) to authenticated;
