begin;
-- Separate delivery storage keeps existing deployed clients and base receipts unchanged.
create table public.extra_leave_usage_notices (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 employee_id uuid not null references public.profiles(id), grant_id uuid not null references app.employee_extra_leave(id),
 grant_version integer not null, notice_source text not null check(notice_source in ('extra','birthday')),
 recipient_name text not null, phase text not null check(phase in ('registered','threeMonths','oneMonth','twoWeeks','oneWeek')),
 scheduled_on date not null, expires_on date not null, starts_on date not null,
 granted_days numeric not null check(granted_days>0), remaining_days numeric not null check(remaining_days>=0),
 reserved_days numeric not null check(reserved_days>=0), reason text not null, title text not null, body text not null,
 issued_at timestamptz not null default clock_timestamp(), read_at timestamptz, viewed_at timestamptz,
 confirmed_at timestamptz, confirmed_session_id uuid, invalidated_at timestamptz,
 unique(grant_id,grant_version,phase), check(scheduled_on<=expires_on),
 check(read_at is null or read_at>=issued_at),
 check(viewed_at is null or(read_at is not null and viewed_at>=read_at)),
 check(confirmed_at is null or(viewed_at is not null and confirmed_at>=viewed_at and confirmed_session_id is not null))
);
create index extra_leave_notices_employee on public.extra_leave_usage_notices(employee_id,issued_at desc);
create index extra_leave_notices_company on public.extra_leave_usage_notices(company_id,issued_at desc);
alter table public.extra_leave_usage_notices enable row level security;
revoke all on public.extra_leave_usage_notices from public,anon,authenticated;
grant select on public.extra_leave_usage_notices to authenticated;
create policy extra_leave_notices_own_read on public.extra_leave_usage_notices for select to authenticated
 using(employee_id=(select auth.uid()) and company_id=(select company_id from public.profiles where id=auth.uid() and status='active'));

create function app.extra_leave_notice_grants(p_company uuid)
returns table(id uuid,employee_id uuid,notice_source text,days numeric,starts_on date,expires_on date,reason text,version integer,
 available numeric,reserved numeric,deleted_at timestamptz,created_on date,updated_on date)
language sql stable security definer set search_path='' as $$
 select g.id,g.employee_id,case g.grant_source when 'birthday' then 'birthday' else 'extra' end,g.days,g.granted_on,g.expires_on,g.note,g.version,
 greatest(g.days-coalesce(u.used,0),0),coalesce(u.reserved,0),g.deleted_at,
 (g.created_at at time zone 'Asia/Seoul')::date,(g.updated_at at time zone 'Asia/Seoul')::date
 from app.employee_extra_leave g left join lateral (
   select sum(days) used,sum(days) filter(where used_on>(now() at time zone 'Asia/Seoul')::date) reserved
   from app.employee_extra_leave_usage where grant_id=g.id and refunded_at is null
 ) u on true where g.company_id=p_company;
$$;
revoke all on function app.extra_leave_notice_grants(uuid) from public,anon,authenticated;

create function app.dispatch_extra_leave_grant_notice(p_grant uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare g record; employee uuid; company uuid; recipient text; today date:=(now() at time zone 'Asia/Seoul')::date;
 stage text; due date; added integer; label text; registration_exists boolean;
begin
 select employee_id,company_id into employee,company from app.employee_extra_leave where id=p_grant;
 if not found then return 0; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(employee::text,0));
 select * into g from app.extra_leave_notice_grants(company) where id=p_grant;
 update public.extra_leave_usage_notices set invalidated_at=clock_timestamp()
   where grant_id=g.id and invalidated_at is null and (grant_version<>g.version or g.deleted_at is not null);
 if g.deleted_at is not null or today<g.starts_on or today>g.expires_on then return 0; end if;
 select coalesce(nullif(btrim(p.display_name),''),'직원') into recipient from public.profiles p
 join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
 join app.leave_notice_settings s on s.company_id=p.company_id and s.enabled
 where p.id=employee and p.company_id=company and p.status='active' and r.resigned_on is null;
 if not found then return 0; end if;
 registration_exists:=exists(select 1 from public.extra_leave_usage_notices where grant_id=g.id and grant_version=g.version and phase='registered');
 if not registration_exists then stage:='registered';due:=today;
 else
   if g.available<=0 then return 0; end if;
   select v.phase,v.day into stage,due from (values
     ('threeMonths',(g.expires_on-interval '3 months')::date),('oneMonth',(g.expires_on-interval '1 month')::date),
     ('twoWeeks',g.expires_on-14),('oneWeek',g.expires_on-7)
   ) v(phase,day) where (case when g.notice_source='birthday' then v.phase='oneWeek' else v.phase<>'oneWeek' end)
     and v.day>greatest(g.starts_on,g.created_on,g.updated_on) and v.day<=today
     -- Registration already explains the deadline. Do not send a backlog alongside it.
     and v.day>(select (issued_at at time zone 'Asia/Seoul')::date from public.extra_leave_usage_notices where grant_id=g.id and grant_version=g.version and phase='registered')
   order by v.day desc limit 1;
   if stage is null then return 0; end if;
 end if;
 label:=case when g.notice_source='birthday' then '생일 반차' else '추가 연차' end;
 insert into public.extra_leave_usage_notices(company_id,employee_id,grant_id,grant_version,notice_source,recipient_name,phase,scheduled_on,
   expires_on,starts_on,granted_days,remaining_days,reserved_days,reason,title,body)
 values(company,employee,g.id,g.version,g.notice_source,recipient,stage,due,g.expires_on,g.starts_on,g.days,g.available,g.reserved,g.reason,
   label||case when stage='registered' then case when g.version>1 then ' 변경 안내' else ' 등록 안내' end else ' 만료 예정 안내' end,
   recipient||'님, '||case when stage='registered' then label||' '||g.days||'일이 등록되었습니다.' else label||' 사용기한까지 '||(g.expires_on-today)||'일 남았습니다.' end
   ||chr(10)||'사유: '||g.reason||chr(10)||'부여 일수: '||g.days||'일'||chr(10)||'추가로 신청 가능한 일수: '||g.available||'일'
   ||chr(10)||'사용 예약: '||g.reserved||'일'||chr(10)||'사용 기간: '||g.starts_on||' ~ '||g.expires_on||' (마지막 날 포함)'
   ||chr(10)||'기한이 지나면 사용하지 않은 일수는 소멸됩니다. 반반차로 나누거나 연차에 섞어 사용할 수 있습니다.')
 on conflict(grant_id,grant_version,phase) do nothing;
 get diagnostics added=row_count;return added;
end $$;
revoke all on function app.dispatch_extra_leave_grant_notice(uuid) from public,anon,authenticated;

create function app.extra_leave_notice_after_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_kind='extra' and new.kind in ('granted','edited','revoked') then
   perform app.dispatch_extra_leave_grant_notice(new.source_key::uuid);
 end if;
 return new;
end $$;
revoke all on function app.extra_leave_notice_after_event() from public,anon,authenticated;
-- The lifecycle event is written after allocation/recalculation, in the same transaction.
create trigger extra_leave_notice_after_event after insert on app.leave_lifecycle_events
 for each row execute function app.extra_leave_notice_after_event();

create function app.dispatch_extra_leave_usage_notices()
returns integer language plpgsql security definer set search_path='' as $$
declare g record; added integer:=0;
begin
 for g in select id from app.employee_extra_leave order by employee_id,id loop
   added:=added+app.dispatch_extra_leave_grant_notice(g.id);
 end loop;
 return added;
end $$;
revoke all on function app.dispatch_extra_leave_usage_notices() from public,anon,authenticated;
alter function app.dispatch_leave_usage_notices() rename to dispatch_leave_usage_notices_before_extra;
revoke all on function app.dispatch_leave_usage_notices_before_extra() from public,anon,authenticated;
create function app.dispatch_leave_usage_notices()
returns integer language plpgsql security definer set search_path='' as $$
begin return app.dispatch_leave_usage_notices_before_extra()+app.dispatch_extra_leave_usage_notices();end $$;
revoke all on function app.dispatch_leave_usage_notices() from public,anon,authenticated;

create function app.list_my_extra_leave_notices()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();company uuid;
begin
 select company_id into company from public.profiles where id=actor and status='active';
 if company is null then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(n)-'confirmed_session_id' order by n.issued_at desc)
 from public.extra_leave_usage_notices n join app.extra_leave_notice_grants(company) g on g.id=n.grant_id
 where n.employee_id=actor and n.company_id=company and n.invalidated_at is null and g.deleted_at is null
   and g.version=n.grant_version and g.expires_on>=(now() at time zone 'Asia/Seoul')::date
   and (n.phase='registered' or g.available>0)),'[]'::jsonb);
end $$;
revoke all on function app.list_my_extra_leave_notices() from public,anon;
grant execute on function app.list_my_extra_leave_notices() to authenticated;
create function public.list_my_extra_leave_notices() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_extra_leave_notices()$$;
revoke all on function public.list_my_extra_leave_notices() from public,anon;
grant execute on function public.list_my_extra_leave_notices() to authenticated;

create function app.record_extra_leave_notice(p_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();company uuid;session uuid;
begin
 select company_id into company from public.profiles where id=actor and status='active';
 if actor is null or company is null then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 if p_action is null or p_action not in ('read','view','confirm') then raise exception '올바르지 않은 처리입니다.';end if;
 if exists(select 1 from public.impersonation_events where target_id=actor and ended_at is null) then
   raise exception '직원 계정 전환 중에는 본인 확인 기록을 남길 수 없습니다.' using errcode='42501';end if;
 if p_action='confirm' then
   session:=nullif(auth.jwt()->>'session_id','')::uuid;
   if session is null or not exists(select 1 from auth.sessions where id=session and user_id=actor) then
     raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';end if;
 end if;
 if p_id is null and p_action<>'read' then raise exception '안내문을 선택해 주세요.';end if;
 if p_id is not null and not exists(select 1 from public.extra_leave_usage_notices where id=p_id and employee_id=actor and company_id=company and invalidated_at is null) then
   raise exception '유효한 본인 안내문만 확인할 수 있습니다.' using errcode='42501';end if;
 if p_action='confirm' and not exists(select 1 from public.extra_leave_usage_notices where id=p_id and viewed_at is not null) then raise exception '안내문을 먼저 열람해 주세요.';end if;
 update public.extra_leave_usage_notices set
   read_at=coalesce(read_at,greatest(now(),issued_at)),
   viewed_at=case when p_action in ('view','confirm') then coalesce(viewed_at,greatest(now(),read_at,issued_at)) else viewed_at end,
   confirmed_at=case when p_action='confirm' then coalesce(confirmed_at,greatest(now(),viewed_at,read_at,issued_at)) else confirmed_at end,
   confirmed_session_id=case when p_action='confirm' then coalesce(confirmed_session_id,session) else confirmed_session_id end
 where employee_id=actor and company_id=company and invalidated_at is null and (p_id is null or id=p_id);
end $$;
revoke all on function app.record_extra_leave_notice(uuid,text) from public,anon;
grant execute on function app.record_extra_leave_notice(uuid,text) to authenticated;
create function public.record_extra_leave_notice(p_id uuid,p_action text) returns void language sql security invoker set search_path='' as $$select app.record_extra_leave_notice(p_id,p_action)$$;
revoke all on function public.record_extra_leave_notice(uuid,text) from public,anon;
grant execute on function public.record_extra_leave_notice(uuid,text) to authenticated;

create function app.leave_notice_management_v2()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payload jsonb;company uuid;
begin
 payload:=app.leave_usage_notice_management(); -- Preserve the existing manager gate.
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 return payload||jsonb_build_object('extraEnabled',true,
   'extraGrants',coalesce((select jsonb_agg(g order by employee_id,expires_on,id) from app.extra_leave_notice_grants(company) g),'[]'::jsonb),
   'extraNotices',coalesce((select jsonb_agg(to_jsonb(n)-'confirmed_session_id' order by issued_at desc) from public.extra_leave_usage_notices n where n.company_id=company),'[]'::jsonb));
end $$;
revoke all on function app.leave_notice_management_v2() from public,anon;
grant execute on function app.leave_notice_management_v2() to authenticated;
create function public.leave_notice_management_v2() returns jsonb language sql stable security invoker set search_path='' as $$select app.leave_notice_management_v2()$$;
revoke all on function public.leave_notice_management_v2() from public,anon;
grant execute on function public.leave_notice_management_v2() to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   alter publication supabase_realtime add table public.extra_leave_usage_notices;
 end if;
end $$;
commit;
