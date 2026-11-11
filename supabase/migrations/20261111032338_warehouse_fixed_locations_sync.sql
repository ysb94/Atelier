-- One read-only snapshot per brand. The Edge Function verifies the caller before
-- reading it; only the server role can access this table and publish a snapshot.
create table public.warehouse_fixed_location_snapshots (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  content_revision timestamptz not null,
  source_read_started_at timestamptz not null,
  synced_at timestamptz not null
);

alter table public.warehouse_fixed_location_snapshots enable row level security;
revoke all on public.warehouse_fixed_location_snapshots from public, anon, authenticated;
grant select, insert, update on public.warehouse_fixed_location_snapshots to service_role;

create function public.save_warehouse_fixed_location_snapshot(
  p_brand_id uuid,
  p_rows jsonb,
  p_source_read_started_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_read_started_at timestamptz;
begin
  insert into public.warehouse_fixed_location_snapshots (brand_id, rows, content_revision, source_read_started_at, synced_at)
  values (p_brand_id, p_rows, p_source_read_started_at, p_source_read_started_at, clock_timestamp())
  on conflict (brand_id) do nothing;

  select snapshot.source_read_started_at into previous_read_started_at
  from public.warehouse_fixed_location_snapshots as snapshot
  where snapshot.brand_id = p_brand_id
  for update;

  -- A slower manual or scheduled request must never overwrite a newer read.
  if previous_read_started_at >= p_source_read_started_at then return; end if;

  update public.warehouse_fixed_location_snapshots as snapshot
  set rows = p_rows, content_revision = p_source_read_started_at
  where snapshot.brand_id = p_brand_id and snapshot.rows is distinct from p_rows;

  update public.warehouse_fixed_location_snapshots as snapshot
  set source_read_started_at = p_source_read_started_at, synced_at = clock_timestamp()
  where snapshot.brand_id = p_brand_id;
end;
$$;

revoke all on function public.save_warehouse_fixed_location_snapshot(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_warehouse_fixed_location_snapshot(uuid, jsonb, timestamptz) to service_role;

-- The scheduled request remains idle until both Vault values are set.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.schedule(
  'atelier-warehouse-fixed-locations',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := rtrim(config.project_url, '/') || '/functions/v1/warehouse-fixed-locations',
    body := '{"action":"scheduled"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || config.sync_secret),
    timeout_milliseconds := 30000
  )
  from (
    select
      max(decrypted_secret) filter (where name = 'warehouse_fixed_locations_project_url') as project_url,
      max(decrypted_secret) filter (where name = 'warehouse_fixed_locations_cron_secret') as sync_secret
    from vault.decrypted_secrets
    where name in ('warehouse_fixed_locations_project_url', 'warehouse_fixed_locations_cron_secret')
  ) as config
  where config.project_url ~ '^https://[a-z0-9]+\.supabase\.co/?$'
    and config.sync_secret ~ '^[a-f0-9]{64}$';
  $job$
);
