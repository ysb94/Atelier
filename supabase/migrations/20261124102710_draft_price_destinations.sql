create table public.draft_price_destinations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.permission_company_id() references public.companies(id) on delete cascade,
  source_draft_id uuid references public.product_drafts(id) on delete set null,
  name text not null,
  normalized_name text generated always as (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) stored,
  constraint draft_price_destinations_name_check check (
    char_length(name) between 1 and 40 and name = btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))
  ),
  constraint draft_price_destinations_reserved_check check (normalized_name not in (
    'china (김웅사장님)', 'china (외부 업체)', 'china', '중국', 'korea', '한국',
    'promotion [중국]', 'promotion [china]', '기타 제조처'
  )),
  unique (company_id, normalized_name)
);

create index draft_price_destinations_source_draft_idx
  on public.draft_price_destinations(source_draft_id) where source_draft_id is not null;

alter table public.draft_price_destinations enable row level security;
revoke all on public.draft_price_destinations from public, anon, authenticated;
grant select (id, name), insert (name, source_draft_id) on public.draft_price_destinations to authenticated;

create policy draft_price_destinations_company_read on public.draft_price_destinations
  for select to authenticated using (company_id = (select app.permission_company_id()));

create policy draft_price_destinations_create_from_draft on public.draft_price_destinations
  for insert to authenticated with check (
    company_id = (select app.permission_company_id()) and app.draft_write_allowed(source_draft_id)
  );
