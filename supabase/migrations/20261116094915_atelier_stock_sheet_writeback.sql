-- Install dark. The operating sheet worker and the Edge Function can be upgraded before activation.
create table app.atelier_stock_sheet_settings (
  brand_id uuid primary key references public.brands(id),
  enabled_at timestamptz not null default clock_timestamp()
);

create table app.atelier_stock_sheet_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  row_ids text[] not null,
  lock_keys text[] not null,
  before_rows jsonb not null,
  after_rows jsonb not null,
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  attempts integer not null default 0,
  failure jsonb,
  failed_at timestamptz,
  completed_at timestamptz,
  removal_marker_ids text[] not null default '{}'
);

create table app.atelier_stock_sheet_events (
  event_no bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id),
  source text not null check (source in ('condition', 'stock', 'repair')),
  source_id uuid not null,
  row_ids text[] not null check (cardinality(row_ids) > 0),
  lock_keys text[] not null,
  before_rows jsonb not null,
  after_rows jsonb not null,
  job_id uuid references app.atelier_stock_sheet_jobs(id),
  completed_at timestamptz,
  unique (brand_id, source, source_id)
);

create index atelier_stock_sheet_event_pending
  on app.atelier_stock_sheet_events (brand_id, event_no) where completed_at is null;
create index atelier_stock_sheet_event_job on app.atelier_stock_sheet_events (job_id);
create index atelier_stock_sheet_event_rows
  on app.atelier_stock_sheet_events using gin (row_ids) where completed_at is null;
create index atelier_stock_sheet_event_keys
  on app.atelier_stock_sheet_events using gin (lock_keys) where job_id is null;
create index atelier_stock_sheet_event_recent
  on app.atelier_stock_sheet_events (brand_id, completed_at) where completed_at is not null;
create index atelier_stock_sheet_job_pending
  on app.atelier_stock_sheet_jobs (brand_id, available_at, id) where completed_at is null;
create index atelier_stock_sheet_job_removal_markers
  on app.atelier_stock_sheet_jobs (brand_id, completed_at) where cardinality(removal_marker_ids) > 0;

alter table app.atelier_stock_sheet_settings enable row level security;
alter table app.atelier_stock_sheet_jobs enable row level security;
alter table app.atelier_stock_sheet_events enable row level security;
revoke all on app.atelier_stock_sheet_settings, app.atelier_stock_sheet_jobs,
  app.atelier_stock_sheet_events from public, anon, authenticated, service_role;

alter table app.warehouse_stock_condition_exports add column atelier_managed boolean not null default false;
alter table app.warehouse_qr_audit_sheet_exports add column atelier_managed boolean not null default false;
alter table app.warehouse_qr_audit_sheet_exports add column atelier_review boolean not null default false;

-- Legacy writers retain one outstanding record. Managed events retain their own ordered history.
drop index app.warehouse_stock_condition_exports_one_pending;
create unique index warehouse_stock_condition_exports_one_pending
  on app.warehouse_stock_condition_exports (brand_id, external_row_id)
  where sheet_synced_at is null and not atelier_managed;

create function app.atelier_stock_sheet_enabled(p_brand_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (select 1 from app.atelier_stock_sheet_settings where brand_id = p_brand_id);
$$;

create function app.atelier_condition_sheet_row(p_aa text, p_values jsonb, p_opened integer)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_aa, 'qr', upper(btrim(coalesce(p_values->>'boxQr', ''))),
    'values', jsonb_build_array(
      btrim(coalesce(p_values->>'number', '')), btrim(coalesce(p_values->>'productName', '')),
      btrim(coalesce(p_values->>'place', '')), btrim(coalesce(p_values->>'receivedOn', '')),
      case when btrim(p_values->>'units') ~ '^-?[0-9,]+$' then replace(btrim(p_values->>'units'), ',', '')
        else btrim(coalesce(p_values->>'units', '')) end,
      case when btrim(p_values->>'boxes') ~ '^-?[0-9,]+$' then replace(btrim(p_values->>'boxes'), ',', '')
        else btrim(coalesce(p_values->>'boxes', '')) end,
      concat_ws(' · ', case when p_opened > 0 then '개봉 잔량 ' || p_opened || '개' end,
        nullif(btrim(p_values->>'note'), ''))),
    'opened', coalesce(p_opened, 0),
    'rawNote', btrim(coalesce(p_values->>'note', '')), 'preserveNote', coalesce(p_opened, 0) > 0
  );
$$;

create function app.atelier_stock_sheet_keys(p_brand_id uuid, p_rows jsonb)
returns text[] language sql stable set search_path = ''
as $$
  with rows as (
    select r->>'id' as aa, upper(btrim(r->>'qr')) as qr,
      upper(btrim(regexp_replace(r->'values'->>2, '//[[:space:]]*$', ''))) as place
    from jsonb_array_elements(p_rows) r
  ), keys as (
    select 'aa:' || aa as key from rows where aa <> ''
    union select 'qr:' || qr from rows where qr <> ''
    union select 'pick:' || r.place from rows r
      join public.warehouse_inventory_sets s on s.brand_id = p_brand_id and s.kind = 'sandbox' and s.status = 'active'
      join public.warehouse_registered_slots l on l.warehouse_id = s.warehouse_id and upper(l.code) = r.place and l.zone = 'picking'
  )
  select array(select key from keys order by key);
$$;

create function app.record_atelier_stock_sheet_event(
  p_brand_id uuid, p_source text, p_source_id uuid, p_before jsonb, p_after jsonb
)
returns void language sql set search_path = ''
as $$
  insert into app.atelier_stock_sheet_events (brand_id, source, source_id, row_ids, lock_keys, before_rows, after_rows)
  values (p_brand_id, p_source, p_source_id, array(
    select distinct r->>'id'
    from jsonb_array_elements(p_before || p_after) r
    where nullif(r->>'id', '') is not null
    order by r->>'id'
  ), app.atelier_stock_sheet_keys(p_brand_id, p_before || p_after), p_before, p_after);
$$;

create function app.record_atelier_condition_sheet_event(
  p_brand_id uuid, p_source_id uuid, p_aa text, p_before jsonb, p_after jsonb
)
returns void language plpgsql set search_path = ''
as $$
declare
  v_opened integer;
begin
  -- Status-only legacy records carry B/C, place and QR in before_values. Their other values
  -- were captured in sheet_values, so they do not depend on a later inventory version.
  select p.opened_units into v_opened
    from public.warehouse_stock_positions p
    join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
    where p.brand_id = p_brand_id and p.external_row_id = p_aa;
  perform app.record_atelier_stock_sheet_event(
    p_brand_id, 'condition', p_source_id,
    case when p_before is null then '[]'::jsonb else jsonb_build_array(app.atelier_condition_sheet_row(
      p_aa, p_after || p_before, coalesce((p_before->>'openedUnits')::integer, v_opened, 0)
    )) end,
    jsonb_build_array(app.atelier_condition_sheet_row(p_aa, p_after,
      coalesce((p_after->>'openedUnits')::integer, v_opened, 0)))
  );
end;
$$;

create function app.set_atelier_stock_sheet_managed()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'warehouse_qr_audit_sheet_exports' then
    new.atelier_managed := (coalesce(new.stock_request->>'action' in ('move', 'adjust', 'deplete'), false)
      or new.atelier_review) and app.atelier_stock_sheet_enabled(new.brand_id);
  else
    new.atelier_managed := app.atelier_stock_sheet_enabled(new.brand_id);
  end if;
  return new;
end;
$$;

create function app.assert_atelier_stock_sheet_picking(p_brand_id uuid, p_before jsonb, p_after jsonb)
returns void language plpgsql set search_path = ''
as $$
begin
  if exists (
    select 1 from jsonb_array_elements(p_after) r
    join public.warehouse_stock_positions p on p.brand_id = p_brand_id and p.external_row_id = r->>'id'
    join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
    join public.warehouse_locations l on l.id = p.location_id and l.zone = 'picking'
    where app.warehouse_qr_audit_is_active(p)
      and not exists (
        select 1 from jsonb_array_elements(p_before) old
        where old->>'id' = r->>'id' and
          upper(btrim(regexp_replace(old->'values'->>2, '//$', ''))) =
          upper(btrim(regexp_replace(r->'values'->>2, '//$', '')))
      )
      and exists (
        select 1 from public.warehouse_stock_positions q
        where q.set_id = p.set_id and q.location_id = p.location_id and q.id <> p.id
          and app.warehouse_qr_audit_is_active(q)
      )
  ) then
    raise exception '출고창고 자리에 이미 다른 재고가 있습니다.' using errcode = '23505';
  end if;
end;
$$;

create function app.capture_atelier_stock_sheet_event()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'warehouse_qr_audit_sheet_exports' then
    perform app.assert_atelier_stock_sheet_picking(new.brand_id, new.before_rows, new.after_rows);
    perform app.record_atelier_stock_sheet_event(new.brand_id, 'stock', new.id, new.before_rows, new.after_rows);
  else
    perform app.assert_atelier_stock_sheet_picking(new.brand_id,
      case when new.before_values is null then '[]'::jsonb else jsonb_build_array(
        app.atelier_condition_sheet_row(new.external_row_id, new.before_values, 0)) end,
      jsonb_build_array(app.atelier_condition_sheet_row(new.external_row_id, new.sheet_values, 0)));
    perform app.record_atelier_condition_sheet_event(new.brand_id, new.request_id, new.external_row_id,
      new.before_values, new.sheet_values);
  end if;
  return new;
end;
$$;

create trigger atelier_stock_sheet_manage_condition
before insert on app.warehouse_stock_condition_exports for each row execute function app.set_atelier_stock_sheet_managed();
create trigger atelier_stock_sheet_manage_work
before insert on app.warehouse_qr_audit_sheet_exports for each row execute function app.set_atelier_stock_sheet_managed();
create trigger atelier_stock_sheet_capture_condition
after insert on app.warehouse_stock_condition_exports
for each row when (new.atelier_managed) execute function app.capture_atelier_stock_sheet_event();
create trigger atelier_stock_sheet_capture_work
after insert on app.warehouse_qr_audit_sheet_exports
for each row when (new.atelier_managed) execute function app.capture_atelier_stock_sheet_event();

revoke all on function app.atelier_stock_sheet_enabled(uuid), app.atelier_condition_sheet_row(text,jsonb,integer),
  app.atelier_stock_sheet_keys(uuid,jsonb),
  app.record_atelier_stock_sheet_event(uuid,text,uuid,jsonb,jsonb),
  app.record_atelier_condition_sheet_event(uuid,uuid,text,jsonb,jsonb),
  app.set_atelier_stock_sheet_managed(), app.assert_atelier_stock_sheet_picking(uuid,jsonb,jsonb),
  app.capture_atelier_stock_sheet_event()
from public, anon, authenticated, service_role;

create function public.activate_atelier_stock_sheet_writeback(p_brand_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_event record;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez') then
    raise exception '창고입력 연동 브랜드를 확인해주세요.' using errcode = '22023';
  end if;
  insert into app.atelier_stock_sheet_settings (brand_id) values (p_brand_id) on conflict do nothing;
  if not found then return 0; end if;

  -- Adopt still-pending Atelier records only. Completed history is never replayed as a batch.
  for v_event in
    select 'condition' as source, request_id as id, saved_at as logged_at, to_jsonb(e) as payload
    from app.warehouse_stock_condition_exports e where brand_id = p_brand_id and sheet_synced_at is null
    union all
    select 'stock', id, queued_at, to_jsonb(e)
    from app.warehouse_qr_audit_sheet_exports e
    where brand_id = p_brand_id and (stock_request->>'action' in ('move', 'adjust', 'deplete')
      or (stock_request is null and whole_place is null)) and sheet_synced_at is null
    order by logged_at, id
  loop
    if v_event.source = 'condition' then
      perform app.record_atelier_condition_sheet_event(p_brand_id, v_event.id, v_event.payload->>'external_row_id',
        nullif(v_event.payload->'before_values', 'null'::jsonb), v_event.payload->'sheet_values');
      update app.warehouse_stock_condition_exports set atelier_managed = true
      where brand_id = p_brand_id and request_id = v_event.id;
    else
      perform app.record_atelier_stock_sheet_event(p_brand_id, 'stock', v_event.id,
        v_event.payload->'before_rows', v_event.payload->'after_rows');
      update app.warehouse_qr_audit_sheet_exports set atelier_managed = true
      where brand_id = p_brand_id and id = v_event.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.claim_atelier_stock_sheet_jobs(p_brand_id uuid, p_limit integer default 6)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 10);
  v_jobs uuid[] := '{}'::uuid[];
  v_seen bigint[] := '{}'::bigint[];
  v_component bigint[];
  v_rows text[];
  v_keys text[];
  v_before jsonb;
  v_after jsonb;
  v_seed bigint;
  v_job uuid;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if not app.atelier_stock_sheet_enabled(p_brand_id) then
    return jsonb_build_object('enabled', false, 'jobs', '[]'::jsonb);
  end if;

  -- Reserve at least one slot for a due retry without delaying unrelated new work.
  select id into v_job from app.atelier_stock_sheet_jobs
  where brand_id = p_brand_id and completed_at is null and available_at <= clock_timestamp()
  order by available_at, id limit 1;
  if found then v_jobs := array_append(v_jobs, v_job); end if;

  while cardinality(v_jobs) < v_limit loop
    select event_no into v_seed from app.atelier_stock_sheet_events
    where brand_id = p_brand_id and completed_at is null and job_id is null and not (event_no = any(v_seen))
    order by event_no limit 1;
    exit when not found;
    with recursive component(event_no, row_ids, lock_keys) as (
      select e.event_no, e.row_ids, e.lock_keys from app.atelier_stock_sheet_events e where e.event_no = v_seed
      union
      select e.event_no, e.row_ids, e.lock_keys from component c join app.atelier_stock_sheet_events e
      on e.brand_id = p_brand_id and e.completed_at is null and e.job_id is null and e.lock_keys && c.lock_keys
    )
    select array(select event_no from component),
      array(select distinct aa from component cross join lateral unnest(row_ids) aa order by aa),
      array(select distinct key from component cross join lateral unnest(lock_keys) key order by key)
    into v_component, v_rows, v_keys;
    v_seen := v_seen || v_component;

    -- An immutable claimed plan may already have reached Sheets even if its acknowledgement was lost.
    if exists (select 1 from app.atelier_stock_sheet_jobs j
      where j.brand_id = p_brand_id and j.completed_at is null and j.lock_keys && v_keys) then
      continue;
    end if;

    with transitions as (
      select aa, e.event_no, e.before_rows, e.after_rows
      from app.atelier_stock_sheet_events e cross join lateral unnest(e.row_ids) aa
      where e.event_no = any(v_component)
    ), endpoints as (
      select aa, min(event_no) as first_no, max(event_no) as last_no from transitions group by aa
    )
    select coalesce(jsonb_agg(old.row order by b.aa) filter (where old.row is not null), '[]'),
      coalesce(jsonb_agg(case
        when coalesce(old.row->>'opened', '0') <> coalesce(new.row->>'opened', '0')
          then jsonb_set(new.row, '{preserveNote}', 'false')
        else new.row end order by b.aa) filter (where new.row is not null), '[]')
    into v_before, v_after
    from endpoints b
    join transitions f on f.aa = b.aa and f.event_no = b.first_no
    join transitions l on l.aa = b.aa and l.event_no = b.last_no
    left join lateral (select r as row from jsonb_array_elements(f.before_rows) r where r->>'id' = b.aa) old on true
    left join lateral (select r as row from jsonb_array_elements(l.after_rows) r where r->>'id' = b.aa) new on true;

    insert into app.atelier_stock_sheet_jobs (brand_id, row_ids, lock_keys, before_rows, after_rows)
    values (p_brand_id, v_rows, v_keys, v_before, v_after) returning id into v_job;
    update app.atelier_stock_sheet_events set job_id = v_job where event_no = any(v_component);
    v_jobs := array_append(v_jobs, v_job);
  end loop;

  v_jobs := v_jobs || array(
    select id from app.atelier_stock_sheet_jobs
    where brand_id = p_brand_id and completed_at is null and available_at <= clock_timestamp() and not (id = any(v_jobs))
    order by available_at, id limit (v_limit - cardinality(v_jobs))
  );
  with leased as (
    update app.atelier_stock_sheet_jobs
    set available_at = clock_timestamp() + interval '8 minutes', lease_token = gen_random_uuid(),
        attempts = attempts + 1
    where brand_id = p_brand_id and id = any(v_jobs)
    returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'lease', lease_token, 'kind', 'stock',
    'ids', row_ids, 'before', before_rows, 'after', after_rows,
    'picking', array(select substring(key from 6) from unnest(lock_keys) key where key like 'pick:%')
  ) order by array_position(v_jobs,id)), '[]') into v_result from leased;
  return jsonb_build_object('enabled', true, 'jobs', v_result, 'cleanup', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'ids', r.removal_marker_ids))
    from (select id, removal_marker_ids from app.atelier_stock_sheet_jobs
      where brand_id = p_brand_id and cardinality(removal_marker_ids) > 0
      order by completed_at, id limit 12) r
  ), '[]'));
end;
$$;

create function public.finish_atelier_stock_sheet_job(
  p_brand_id uuid, p_job_id uuid, p_lease uuid, p_rows jsonb, p_absent text[]
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_job app.atelier_stock_sheet_jobs;
  v_expected jsonb;
  v_observed jsonb;
  v_completed timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or p_absent is null or p_lease is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_job from app.atelier_stock_sheet_jobs where id = p_job_id and brand_id = p_brand_id for update;
  if not found or v_job.lease_token is distinct from p_lease then return false; end if;

  if array(select id from unnest(v_job.row_ids) id
       where not exists (select 1 from jsonb_array_elements(v_job.after_rows) r where r->>'id' = id) order by id)
       is distinct from array(select id from unnest(p_absent) id order by id) then
    return false;
  end if;
  select coalesce(jsonb_agg(row order by row->>'id'), '[]') into v_observed
    from jsonb_array_elements(p_rows) row;
  select coalesce(jsonb_agg(case when r->>'preserveNote' = 'true' and actual.row->'values'->>6 = r->>'rawNote'
    then jsonb_set(r - array['opened','rawNote','preserveNote'], '{values,6}', r->'rawNote')
    else r - array['opened','rawNote','preserveNote'] end order by r->>'id'), '[]')
  into v_expected
  from jsonb_array_elements(v_job.after_rows) r
  left join lateral (select row from jsonb_array_elements(p_rows) row where row->>'id' = r->>'id' limit 1) actual on true;
  if v_observed is distinct from v_expected then return false; end if;
  if v_job.completed_at is not null then return true; end if;

  update app.atelier_stock_sheet_jobs
  set completed_at = v_completed, failure = null, failed_at = null,
      removal_marker_ids = array(select r->>'id' from jsonb_array_elements(v_job.before_rows) r
        where r->>'id' = any(p_absent))
  where id = v_job.id;
  update app.atelier_stock_sheet_events set completed_at = v_completed where job_id = v_job.id;
  update app.warehouse_stock_condition_exports e set sheet_synced_at = coalesce(e.sheet_synced_at, v_completed)
  from app.atelier_stock_sheet_events w
  where w.job_id = v_job.id and w.source = 'condition' and e.brand_id = p_brand_id and e.request_id = w.source_id;
  update app.warehouse_qr_audit_sheet_exports e set sheet_synced_at = coalesce(e.sheet_synced_at, v_completed)
  from app.atelier_stock_sheet_events w
  where w.job_id = v_job.id and w.source = 'stock' and e.brand_id = p_brand_id and e.id = w.source_id;
  return true;
end;
$$;

create function public.release_atelier_stock_sheet_removal_markers(p_brand_id uuid, p_job_id uuid)
returns boolean language sql security definer set search_path = ''
as $$
  with released as (
    update app.atelier_stock_sheet_jobs set removal_marker_ids = '{}'
    where id = p_job_id and brand_id = p_brand_id and completed_at is not null returning id
  )
  select exists (select 1 from released);
$$;

create function public.fail_atelier_stock_sheet_job(
  p_brand_id uuid, p_job_id uuid, p_lease uuid, p_reason text, p_differences jsonb
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_lease is null or coalesce(p_reason,'') !~ '^[A-Z_]{1,60}$'
    or jsonb_typeof(p_differences) is distinct from 'array' or octet_length(p_differences::text) > 28000 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  update app.atelier_stock_sheet_jobs
  set failure = jsonb_build_object('reason', p_reason, 'differences', p_differences),
      failed_at = clock_timestamp(), available_at = clock_timestamp() + interval '2 minutes',
      lease_token = null
  where id = p_job_id and brand_id = p_brand_id and lease_token = p_lease and completed_at is null;
  return found;
end;
$$;

create function public.list_atelier_stock_sheet_conflicts(p_brand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 동기화 이력을 확인할 권한이 없습니다.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.failed_at desc)
    from (select id, row_ids, failed_at, failure from app.atelier_stock_sheet_jobs
      where brand_id = p_brand_id and completed_at is null and failed_at is not null
      order by failed_at desc, id limit 50) r), '[]');
end;
$$;

revoke all on function public.activate_atelier_stock_sheet_writeback(uuid), public.claim_atelier_stock_sheet_jobs(uuid,integer),
  public.finish_atelier_stock_sheet_job(uuid,uuid,uuid,jsonb,text[]),
  public.fail_atelier_stock_sheet_job(uuid,uuid,uuid,text,jsonb), public.list_atelier_stock_sheet_conflicts(uuid),
  public.release_atelier_stock_sheet_removal_markers(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.activate_atelier_stock_sheet_writeback(uuid), public.claim_atelier_stock_sheet_jobs(uuid,integer),
  public.finish_atelier_stock_sheet_job(uuid,uuid,uuid,jsonb,text[]), public.fail_atelier_stock_sheet_job(uuid,uuid,uuid,text,jsonb),
  public.release_atelier_stock_sheet_removal_markers(uuid,uuid)
to service_role;
grant execute on function public.list_atelier_stock_sheet_conflicts(uuid) to authenticated;

-- The shared Finder guard still treats Atelier writes as pending. Only the Atelier
-- save entry points use this narrower guard, and only managed writes can be passed.
create function app.assert_atelier_stock_sheet_ready(
  p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null
)
returns void language plpgsql set search_path = ''
as $$
begin
  if exists (
    select 1 from app.warehouse_qr_audit_sheet_exports e
    where e.brand_id = p_brand_id and e.sheet_synced_at is null and not e.atelier_managed and (
      upper(e.whole_place) = upper(btrim(p_place))
      or exists (
        select 1 from jsonb_array_elements(e.before_rows || e.after_rows) r
        where (nullif(btrim(p_place), '') is not null and
          upper(regexp_replace(r->'values'->>2, '//[[:space:]]*$', '')) = upper(btrim(p_place)))
          or (nullif(btrim(p_qr), '') is not null and upper(r->>'qr') = upper(btrim(p_qr)))
          or r->>'id' = p_row_id
      )
    )
  ) then
    raise exception '이 자리 또는 박스의 작업이 창고입력에 반영되는 중입니다. 잠시 후 다시 시도해주세요.'
      using errcode = 'PQA01';
  end if;
end;
$$;
revoke all on function app.assert_atelier_stock_sheet_ready(uuid,text,text,text)
from public, anon, authenticated, service_role;

-- Finder and site-wide QR audits still wait for any relevant outstanding sheet write.
create or replace function app.warehouse_qr_audit_sheet_pending(
  p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null
)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from app.warehouse_qr_audit_sheet_exports e
    where e.brand_id = p_brand_id and e.sheet_synced_at is null and (
      upper(e.whole_place) = upper(btrim(p_place))
      or exists (
        select 1 from jsonb_array_elements(e.before_rows || e.after_rows) r
        where (nullif(btrim(p_place), '') is not null and
          upper(regexp_replace(r->'values'->>2, '//[[:space:]]*$', '')) = upper(btrim(p_place)))
          or (nullif(btrim(p_qr), '') is not null and upper(r->>'qr') = upper(btrim(p_qr)))
          or r->>'id' = p_row_id
      )
    )
  ) or exists (
    select 1 from app.atelier_stock_sheet_events e
    where e.brand_id = p_brand_id and e.completed_at is null and e.source in ('condition', 'repair')
      and exists (select 1 from jsonb_array_elements(e.before_rows || e.after_rows) r
        where upper(regexp_replace(r->'values'->>2, '//[[:space:]]*$', '')) = nullif(upper(btrim(p_place)), '')
          or upper(r->>'qr') = nullif(upper(btrim(p_qr)), '') or r->>'id' = p_row_id)
  );
$$;

-- Change only the validated predicates in the deployed definitions. Locking, request
-- deduplication, record versions, occupancy, permissions, and Finder checks stay in the original routines.
do $migration$
declare
  v_rule record;
  v_definition text;
  v_count integer;
begin
  if strpos(pg_get_functiondef('public.confirm_warehouse_stock_condition_exports(uuid,jsonb)'::regprocedure),
    'observed_values jsonb') = 0 then
    raise exception 'Install verify_warehouse_stock_sheet_writeback before this migration';
  end if;
  for v_rule in select * from (values
    ('public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_atelier_stock_sheet_ready(', 2),
    ('public.correct_warehouse_stock_row(uuid,uuid,uuid,timestamptz,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_atelier_stock_sheet_ready(', 2),
    ('public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_atelier_stock_sheet_ready(', 2),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_atelier_stock_sheet_ready(', 1),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'external_row_id = v_row_id and e.sheet_synced_at is null',
      'external_row_id = v_row_id and e.sheet_synced_at is null and not e.atelier_managed', 1),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'values (gen_random_uuid(),p_brand_id,jsonb_build_array(v_old),jsonb_build_array(v_new));',
      'values (gen_random_uuid(),p_brand_id,jsonb_build_array(v_old),jsonb_build_array(v_new), true);', 1),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'app.warehouse_qr_audit_sheet_exports (id,brand_id,before_rows,after_rows)',
      'app.warehouse_qr_audit_sheet_exports (id,brand_id,before_rows,after_rows,atelier_review)', 1),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'app.warehouse_qr_audit_sheet_row(p, l.code)', 'app.warehouse_stock_work_sheet_row(p, l.code)', 1),
    ('app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb)',
      'app.warehouse_qr_audit_sheet_row(p,l.code)', 'app.warehouse_stock_work_sheet_row(p,l.code)', 1),
    ('public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb)',
      'external_row_id = v_old.external_row_id and sheet_synced_at is null',
      'external_row_id = v_old.external_row_id and sheet_synced_at is null and not atelier_managed', 1),
    ('public.correct_warehouse_stock_row(uuid,uuid,uuid,timestamptz,jsonb)',
      'external_row_id = v_old.external_row_id and sheet_synced_at is null',
      'external_row_id = v_old.external_row_id and sheet_synced_at is null and not atelier_managed', 1),
    ('public.save_warehouse_stock_condition_before_qr_audit(uuid,uuid,uuid,text,text,jsonb)',
      'external_row_id = v_external_id and sheet_synced_at is null',
      'external_row_id = v_external_id and sheet_synced_at is null and not atelier_managed', 1),
    ('public.list_warehouse_stock_condition_exports(uuid)',
      'sheet_synced_at is null', 'sheet_synced_at is null and not atelier_managed', 1),
    ('public.list_warehouse_qr_audit_sheet_exports(uuid)',
      'sheet_synced_at is null', 'sheet_synced_at is null and not atelier_managed', 1),
    ('public.confirm_warehouse_stock_condition_exports(uuid,jsonb)',
      'e.sheet_synced_at is null', 'e.sheet_synced_at is null and not e.atelier_managed', 1),
    ('public.confirm_warehouse_qr_audit_sheet_export(uuid,uuid,jsonb)',
      'e.id = p_id and e.brand_id = p_brand_id', 'e.id = p_id and e.brand_id = p_brand_id and not e.atelier_managed', 1),
    ('public.confirm_warehouse_qr_audit_sheet_export(uuid,uuid,jsonb)',
      'where id = p_id and brand_id = p_brand_id;', 'where id = p_id and brand_id = p_brand_id and not atelier_managed;', 1),
    ('public.replace_warehouse_inventory_snapshot_before_qr_audit(uuid,text,jsonb,timestamptz)',
      'where brand_id = p_brand_id and sheet_synced_at is null',
      'where brand_id = p_brand_id and sheet_synced_at is null and not atelier_managed', 1),
    ('public.replace_warehouse_inventory_snapshot_before_qr_audit(uuid,text,jsonb,timestamptz)',
      'where brand_id = p_brand_id and sheet_synced_at >= p_snapshot_at',
      'where brand_id = p_brand_id and sheet_synced_at >= p_snapshot_at and not atelier_managed', 1)
  ) as rules(signature, previous, replacement, expected)
  loop
    v_definition := pg_get_functiondef(v_rule.signature::regprocedure);
    v_count := (length(v_definition) - length(replace(v_definition, v_rule.previous, ''))) / length(v_rule.previous);
    if v_count <> v_rule.expected then
      raise exception 'Unexpected warehouse writeback definition for % (matched %)', v_rule.signature, v_count;
    end if;
    execute replace(v_definition, v_rule.previous, v_rule.replacement);
  end loop;
end;
$migration$;

create or replace function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid, p_source_file_name text, p_rows jsonb, p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_ids text[];
  v_current jsonb := '[]'::jsonb;
  v_rows jsonb := p_rows;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (select 1 from app.warehouse_qr_audit_sheet_exports
    where brand_id = p_brand_id and not atelier_managed and (sheet_synced_at is null or sheet_synced_at >= p_snapshot_at)) then
    raise exception '창고 작업을 반영하기 전의 창고입력입니다. 시트 반영 후 다시 동기화해주세요.' using errcode = 'PWS07';
  end if;

  -- Keep both still-pending events and work confirmed after the spreadsheet read started.
  -- Missing live rows in this set are tombstones, so a stale import cannot recreate depleted stock.
  select array(
    select distinct aa from app.atelier_stock_sheet_events e cross join lateral unnest(e.row_ids) aa
    where e.brand_id = p_brand_id and (e.completed_at is null or e.completed_at >= p_snapshot_at)
  ) into v_ids;
  if cardinality(v_ids) > 0 then
    select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('location_code', l.code, 'zone', l.zone)
      order by p.source_row_number, p.id), '[]')
    into v_current
    from public.warehouse_stock_positions p
    join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
    join public.warehouse_locations l on l.id = p.location_id
    where p.brand_id = p_brand_id and p.external_row_id = any(v_ids);

    select coalesce(jsonb_agg(r.value order by r.ordinality), '[]') || v_current
    into v_rows
    from jsonb_array_elements(p_rows) with ordinality r
    where not (coalesce(btrim(r.value->>'external_row_id'), '') = any(v_ids))
      and not exists (select 1 from jsonb_array_elements(v_current) d
        where nullif(btrim(r.value->>'box_qr'), '') is not null
          and upper(d->>'box_qr') = upper(btrim(r.value->>'box_qr')))
      and not exists (select 1 from jsonb_array_elements(v_current) d
        where d->>'zone' = 'picking' and upper(d->>'location_code') = upper(btrim(r.value->>'location_code'))
          and (d->>'quantity_status' = 'unknown' or (d->>'remaining_boxes')::integer > 0
            or (d->>'opened_units')::integer > 0));
  end if;

  v_set := public.replace_warehouse_inventory_snapshot_with_qr_audit_overlay(
    p_brand_id, p_source_file_name, v_rows, p_snapshot_at);
  update public.warehouse_stock_positions p set opened_units = r.opened_units, note = r.note
  from jsonb_to_recordset(v_current) r(external_row_id text, opened_units integer, note text)
  where p.set_id = v_set.id and p.brand_id = p_brand_id and p.external_row_id = r.external_row_id
    and (p.opened_units, p.note) is distinct from (r.opened_units, r.note);

  -- Preserve the existing interpretation of legacy move notes on unprotected rows.
  with latest as (
    select distinct on (r->>'id') r as projection
    from app.warehouse_qr_audit_sheet_exports e
    cross join lateral jsonb_array_elements(e.after_rows) r
    where e.brand_id = p_brand_id and e.stock_request is not null
    order by r->>'id', e.queued_at desc, e.id desc
  )
  update public.warehouse_stock_positions p set opened_units = (projection->>'opened')::integer, note = projection->>'rawNote'
  from latest
  where p.set_id = v_set.id and p.brand_id = p_brand_id and p.opened_units = 0
    and p.external_row_id = projection->>'id' and not (p.external_row_id = any(v_ids))
    and (projection->>'opened')::integer > 0
    and (p.note = projection->'values'->>6 or
      (projection->>'preserveNote' = 'true' and p.note = projection->>'rawNote'));
  return v_set;
end;
$$;

-- Repair only an observed baseline that matches a proven pre-change legacy record.
-- The active inventory version must also match. This adjusts the pending plan, not stock or history.
create function public.reconcile_atelier_stock_sheet_baseline(
  p_brand_id uuid, p_aa text, p_expected_updated_at timestamptz, p_observed jsonb
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_latest jsonb;
  v_target jsonb;
  v_event app.atelier_stock_sheet_events;
  v_number bigint;
  v_baseline jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if not app.atelier_stock_sheet_enabled(p_brand_id)
    or nullif(btrim(p_aa), '') is null or p_observed->>'id' is distinct from p_aa
    or jsonb_typeof(p_observed->'values') is distinct from 'array'
    or (case when jsonb_typeof(p_observed->'values') = 'array' then jsonb_array_length(p_observed->'values') <> 7 else true end)
    or p_observed->>'qr' is null
    or not exists (
      select 1 from app.warehouse_stock_condition_exports e
      where e.brand_id = p_brand_id and e.external_row_id = p_aa and e.sheet_synced_at is not null
        and e.before_values ? 'receivedOn'
        and app.atelier_condition_sheet_row(p_aa, e.before_values,
          coalesce((e.before_values->>'openedUnits')::integer,0)) - array['opened','rawNote','preserveNote'] = p_observed
    ) then
    raise exception '현재 시트값과 과거 정정 이력을 다시 확인해주세요.' using errcode = '22023';
  end if;

  select app.warehouse_stock_work_sheet_row(p,l.code,true) into v_target
  from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
  join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.external_row_id = p_aa
    and p.updated_at = p_expected_updated_at and app.warehouse_qr_audit_is_active(p)
    and not exists (select 1 from public.warehouse_stock_positions q
      where q.set_id = p.set_id and q.external_row_id = p_aa and q.id <> p.id);
  if v_target is null or v_target->>'qr' is distinct from p_observed->>'qr' then
    raise exception '재고가 바뀌었습니다. 시트와 Atelier를 다시 조회해주세요.' using errcode = '40001';
  end if;
  if exists (select 1 from app.atelier_stock_sheet_jobs j
    where j.brand_id = p_brand_id and j.completed_at is null and j.row_ids @> array[p_aa]) then
    raise exception '이 행의 반영이 이미 시작됐습니다. 기존 충돌을 먼저 확인해주세요.' using errcode = 'PQA01';
  end if;
  select * into v_event from app.atelier_stock_sheet_events e
  where e.brand_id = p_brand_id and e.completed_at is null and e.row_ids @> array[p_aa]
  order by e.event_no limit 1;
  if found then
    select (select r from jsonb_array_elements(e.after_rows) r where r->>'id' = p_aa)
    into v_latest from app.atelier_stock_sheet_events e
    where e.brand_id = p_brand_id and e.completed_at is null and e.row_ids @> array[p_aa]
    order by e.event_no desc limit 1;
    if (v_latest - array['opened','rawNote','preserveNote']) is distinct from
      (v_target - array['opened','rawNote','preserveNote']) then
      raise exception '대기 중인 최종값과 현재 재고가 다릅니다.' using errcode = '40001';
    end if;
    select coalesce(jsonb_agg(r), '[]') || jsonb_build_array(p_observed) into v_baseline
    from jsonb_array_elements(v_event.before_rows) r where r->>'id' <> p_aa;
    update app.atelier_stock_sheet_events
    set before_rows = v_baseline,
      lock_keys = app.atelier_stock_sheet_keys(p_brand_id, v_baseline || v_event.after_rows)
    where event_no = v_event.event_no;
    return v_event.event_no;
  end if;
  insert into app.atelier_stock_sheet_events (brand_id, source, source_id, row_ids, lock_keys, before_rows, after_rows)
  values (p_brand_id, 'repair', gen_random_uuid(), array[p_aa],
    app.atelier_stock_sheet_keys(p_brand_id, jsonb_build_array(p_observed, v_target)),
    jsonb_build_array(p_observed), jsonb_build_array(v_target))
  returning event_no into v_number;
  return v_number;
end;
$$;
revoke all on function public.reconcile_atelier_stock_sheet_baseline(uuid,text,timestamptz,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.reconcile_atelier_stock_sheet_baseline(uuid,text,timestamptz,jsonb) to service_role;
