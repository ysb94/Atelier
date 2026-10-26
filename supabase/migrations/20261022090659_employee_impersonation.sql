create table public.impersonation_operators (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.impersonation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  operator_id uuid not null references public.profiles(id),
  target_id uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  user_agent text,
  check (ended_at is null or ended_at >= started_at),
  check (user_agent is null or char_length(user_agent) <= 300)
);

create index impersonation_events_operator_open
  on public.impersonation_events (operator_id, started_at desc)
  where ended_at is null;

alter table public.impersonation_operators enable row level security;
alter table public.impersonation_events enable row level security;

revoke all on table public.impersonation_operators from public, anon, authenticated;
revoke all on table public.impersonation_events from public, anon, authenticated;
grant select, insert, update on table public.impersonation_operators to service_role;
grant select, insert, update on table public.impersonation_events to service_role;
revoke delete on table public.impersonation_operators, public.impersonation_events from service_role;

comment on table public.impersonation_operators is '직원 계정 전환을 할 수 있는 운영자. 클라이언트 권한 없음.';
comment on table public.impersonation_events is '직원 계정 전환 감사 기록. 클라이언트 권한 없음.';

do $$
declare
  inserted int;
begin
  insert into public.impersonation_operators (profile_id)
  select p.id
  from public.profiles p
  where p.status = 'active'
    and (
      lower(btrim(p.email)) = 'dev@atelier.local'
      or (p.display_name = '김준영' and p.position = '대표이사')
    );
  get diagnostics inserted = row_count;
  if inserted <> 2 then
    raise exception '직원 계정 전환 운영자는 개발자 계정과 대표이사 김준영 2명이어야 합니다. 반영 %명', inserted;
  end if;
end $$;
