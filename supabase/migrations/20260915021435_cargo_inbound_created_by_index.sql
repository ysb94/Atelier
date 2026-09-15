create index if not exists cargo_inbound_shipments_created_by_idx
  on public.cargo_inbound_shipments (created_by)
  where created_by is not null;
