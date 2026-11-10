-- Immutable, company-scoped issuance ledger. Reprinting never issues new codes.
create table public.warehouse_box_label_batches (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  request_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  source text not null check (source in ('generated', 'imported')),
  label_count integer not null check (label_count between 1 and 200),
  requested_codes text[],
  unique (brand_id, request_id),
  unique (id, brand_id),
  check ((source = 'generated' and requested_codes is null) or
    (source = 'imported' and requested_codes is not null and cardinality(requested_codes) = label_count))
);
create index warehouse_box_label_batches_history_idx
  on public.warehouse_box_label_batches (brand_id, created_at desc, id desc);
create index warehouse_box_label_batches_creator_idx on public.warehouse_box_label_batches (created_by);

create table public.warehouse_box_labels (
  code text primary key check (char_length(code) between 1 and 32 and code = btrim(code) and code !~ '[[:cntrl:]]'),
  batch_id uuid not null,
  brand_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 200),
  foreign key (batch_id, brand_id) references public.warehouse_box_label_batches(id, brand_id),
  unique (batch_id, ordinal)
);
create index warehouse_box_labels_brand_idx on public.warehouse_box_labels (brand_id);

-- Existing brand predicates are broad; also enforce company membership explicitly.
create function app.can_read_box_labels(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and app.can_read_brand(p_brand_id) and exists (
    select 1 from public.profiles p join public.brands b on b.company_id = p.company_id
    where p.id = auth.uid() and p.status = 'active' and b.id = p_brand_id
  );
$$;
revoke all on function app.can_read_box_labels(uuid) from public, anon;
grant execute on function app.can_read_box_labels(uuid) to authenticated;

alter table public.warehouse_box_label_batches enable row level security;
alter table public.warehouse_box_labels enable row level security;
create policy box_label_batches_read on public.warehouse_box_label_batches
  for select to authenticated using (app.can_read_box_labels(brand_id));
create policy box_labels_read on public.warehouse_box_labels
  for select to authenticated using (app.can_read_box_labels(brand_id));
revoke all on public.warehouse_box_label_batches, public.warehouse_box_labels from public, anon, authenticated;
grant select on public.warehouse_box_label_batches, public.warehouse_box_labels to authenticated;

-- Only this function may write. The transaction, unique code constraint, and request
-- lock protect simultaneous clients and retries after a lost network response.
create function app.issue_warehouse_box_labels(
  p_brand_id uuid, p_request_id uuid, p_count integer, p_codes text[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.warehouse_box_label_batches%rowtype;
  v_source text := case when p_codes is null then 'generated' else 'imported' end;
  v_code text;
  v_day text := to_char(statement_timestamp() at time zone 'Asia/Seoul', 'YYMMDD');
  v_inserted integer;
  v_attempt integer;
begin
  if not coalesce(app.can_read_box_labels(p_brand_id) and
    (app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics', p_brand_id)), false) then
    raise exception '박스 번호 발급 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_count is null or p_count not between 1 and 200 then
    raise exception '발급 개수는 1~200개여야 합니다.' using errcode = '22023';
  end if;
  if p_codes is not null and (
    cardinality(p_codes) <> p_count or array_ndims(p_codes) <> 1 or array_lower(p_codes, 1) <> 1 or
    exists (select 1 from unnest(p_codes) c where c is null or char_length(c) not between 1 and 32 or c <> btrim(c) or c ~ '[[:cntrl:]]') or
    (select count(distinct c) from unnest(p_codes) c) <> p_count
  ) then
    raise exception '기존 번호는 중복 없이 한 줄에 32자까지 입력해 주세요.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('box-labels:' || p_brand_id::text || ':' || p_request_id::text, 0));
  select * into v_batch from public.warehouse_box_label_batches where brand_id = p_brand_id and request_id = p_request_id;
  if found then
    if v_batch.source <> v_source or v_batch.label_count <> p_count or v_batch.requested_codes is distinct from p_codes then
      raise exception '이 발급 요청은 이미 다른 내용으로 저장되었습니다.' using errcode = '22023';
    end if;
  else
    insert into public.warehouse_box_label_batches (brand_id, request_id, created_by, source, label_count, requested_codes)
    values (p_brand_id, p_request_id, auth.uid(), v_source, p_count, p_codes) returning * into v_batch;
    for i in 1..p_count loop
      v_attempt := 0;
      loop
        v_attempt := v_attempt + 1;
        if v_attempt > 100 then raise exception '번호 발급을 완료하지 못했습니다. 다시 시도해 주세요.'; end if;
        v_code := case when p_codes is null then
          'ENJ-' || v_day || '-' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0')
          else p_codes[i] end;
        insert into public.warehouse_box_labels (code, batch_id, brand_id, ordinal)
        values (v_code, v_batch.id, p_brand_id, i) on conflict (code) do nothing;
        get diagnostics v_inserted = row_count;
        exit when v_inserted = 1;
        if p_codes is not null then
          raise exception '이미 등록된 번호가 포함되어 있습니다. 발급 내역에서 번호를 검색해 재출력해 주세요.' using errcode = '23505';
        end if;
      end loop;
    end loop;
  end if;
  return jsonb_build_object('id', v_batch.id, 'created_at', v_batch.created_at, 'source', v_batch.source,
    'label_count', v_batch.label_count, 'codes', (select jsonb_agg(code order by ordinal) from public.warehouse_box_labels where batch_id = v_batch.id));
end;
$$;
revoke all on function app.issue_warehouse_box_labels(uuid, uuid, integer, text[]) from public, anon;
grant execute on function app.issue_warehouse_box_labels(uuid, uuid, integer, text[]) to authenticated;

create function public.issue_warehouse_box_labels(
  p_brand_id uuid, p_request_id uuid, p_count integer, p_codes text[] default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select app.issue_warehouse_box_labels(p_brand_id, p_request_id, p_count, p_codes);
$$;
revoke all on function public.issue_warehouse_box_labels(uuid, uuid, integer, text[]) from public, anon;
grant execute on function public.issue_warehouse_box_labels(uuid, uuid, integer, text[]) to authenticated;
