-- 관찰 전용 추가 테이블. 기존 Auth·profiles·출근 RPC·정책은 변경하지 않는다.
create table public.access_ip_reviewers (
  profile_id uuid primary key references public.profiles(id),
  singleton boolean not null default true unique check (singleton)
);
alter table public.access_ip_reviewers enable row level security;
revoke all on public.access_ip_reviewers from public, anon, authenticated;
grant select on public.access_ip_reviewers to authenticated;
grant all on public.access_ip_reviewers to service_role;
create policy access_ip_reviewer_self on public.access_ip_reviewers for select to authenticated
  using (profile_id = (select auth.uid()));
-- 현재 사용자 전용 개발자 계정 한 개만 지정한다. 직책·is_admin 권한과 연결하지 않는다.
insert into public.access_ip_reviewers(profile_id)
select id from public.profiles where email = 'dev@atelier.local' and status = 'active';

create table public.access_ip_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  company_id uuid references public.companies(id),
  person_name text not null check (length(person_name) between 1 and 150),
  event_kind text not null check (event_kind in ('login', 'clock_in_request')),
  event_key uuid not null,
  ip_address inet,
  ip_source text not null check (ip_source in ('cf-connecting-ip', 'unavailable')),
  created_at timestamptz not null default clock_timestamp(),
  constraint access_ip_events_once unique(user_id, event_kind, event_key),
  check ((ip_address is null) = (ip_source = 'unavailable'))
);
create index access_ip_events_time on public.access_ip_events(created_at desc, id desc);
create index access_ip_events_user on public.access_ip_events(user_id, created_at desc);
create index access_ip_events_company on public.access_ip_events(company_id);
alter table public.access_ip_events enable row level security;
revoke all on public.access_ip_events from public, anon, authenticated;
grant select on public.access_ip_events to authenticated;
grant all on public.access_ip_events to service_role;
create policy access_ip_events_owner on public.access_ip_events for select to authenticated
  using (exists (select 1 from public.access_ip_reviewers where profile_id = (select auth.uid())));

create table public.office_ip_reviews (
  ip_address inet primary key,
  status text not null check (status in ('company', 'external', 'unconfirmed')),
  note text not null default '' check (length(note) <= 200),
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  check (masklen(ip_address) = case family(ip_address) when 4 then 32 else 128 end)
);
alter table public.office_ip_reviews enable row level security;
create index office_ip_reviews_reviewer on public.office_ip_reviews(reviewed_by);
revoke all on public.office_ip_reviews from public, anon, authenticated;
grant select, insert, update on public.office_ip_reviews to authenticated;
grant all on public.office_ip_reviews to service_role;
create policy office_ip_reviews_read on public.office_ip_reviews for select to authenticated
  using (exists (select 1 from public.access_ip_reviewers where profile_id = (select auth.uid())));
create policy office_ip_reviews_insert on public.office_ip_reviews for insert to authenticated
  with check (reviewed_by = (select auth.uid()) and exists (select 1 from public.access_ip_reviewers where profile_id = (select auth.uid())));
create policy office_ip_reviews_update on public.office_ip_reviews for update to authenticated
  using (exists (select 1 from public.access_ip_reviewers where profile_id = (select auth.uid())))
  with check (reviewed_by = (select auth.uid()) and exists (select 1 from public.access_ip_reviewers where profile_id = (select auth.uid())));

create function app.stamp_office_ip_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.reviewed_by := auth.uid();
  new.reviewed_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
revoke all on function app.stamp_office_ip_review() from public, anon, authenticated;
create trigger office_ip_review_stamp before insert or update on public.office_ip_reviews
for each row execute function app.stamp_office_ip_review();
comment on table public.office_ip_reviews is '회사 IP의 수동 확인 기록. 출근 제한이나 자동 허용에 사용하지 않는다.';
