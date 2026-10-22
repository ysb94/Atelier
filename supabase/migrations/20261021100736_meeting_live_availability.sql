-- 회의 응답 알림과 일정 요약만 추가한다. 기존 사용자·근태 원본·전역 권한은 변경하지 않는다.
alter table public.meeting_invitations add column response_revision bigint not null default 0;
create table public.meeting_host_notices (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 round_id uuid not null references public.meeting_rounds(id),
 recipient_id uuid not null references public.profiles(id),
 source_profile_id uuid not null references public.profiles(id),
 schedule_version integer not null, response_revision bigint not null,
 kind text not null check(kind in ('unavailable','available')),
 body text not null, created_at timestamptz not null default clock_timestamp(), read_at timestamptz,
 unique(round_id,schedule_version,source_profile_id,response_revision,kind)
);
create index meeting_host_notices_recipient_idx on public.meeting_host_notices(recipient_id,created_at desc);
create index meeting_host_notices_company_idx on public.meeting_host_notices(company_id);
create index meeting_host_notices_source_idx on public.meeting_host_notices(source_profile_id);
alter table public.meeting_host_notices enable row level security;
create policy meeting_host_notices_read on public.meeting_host_notices for select to authenticated
 using(recipient_id=(select auth.uid()) and company_id=(select app.meeting_company_id()) and app.meeting_round_can_read(round_id));
revoke all on public.meeting_host_notices from anon,authenticated;
grant select on public.meeting_host_notices to authenticated;

create or replace function app.meeting_respond(p_round uuid,p_version integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.meeting_rounds; s public.meeting_series; old_status text; rev bigint; all_before boolean; all_after boolean;
begin
 select * into r from public.meeting_rounds where id=p_round for update;
 if not found or not app.meeting_round_can_read(p_round) or r.confirmed_at is null
  or not exists(select 1 from public.meeting_members where series_id=r.series_id and profile_id=auth.uid()) then
  raise exception '초대받은 멤버만 참석 여부를 답할 수 있습니다.' using errcode='42501'; end if;
 if p_version is distinct from r.schedule_version then raise exception '일정이 변경되었습니다. 새 일정을 확인한 뒤 답해 주세요.' using errcode='40001'; end if;
 if p_status is null or p_status not in ('available','unavailable') then raise exception '참석 가능·불가 중 선택하세요.'; end if;
 select * into s from public.meeting_series where id=r.series_id;
 select status into old_status from public.meeting_invitations where round_id=p_round and profile_id=auth.uid() and schedule_version=p_version;
 if old_status=p_status then return; end if;
 select not exists(select 1 from public.meeting_members m left join public.meeting_invitations i
  on i.round_id=p_round and i.profile_id=m.profile_id and i.schedule_version=p_version
  where m.series_id=s.id and coalesce(i.status,'pending')<>'available') into all_before;
 insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,status,responded_at,read_at,response_revision)
 values(r.company_id,p_round,auth.uid(),p_version,p_status,clock_timestamp(),now(),1)
 on conflict(round_id,profile_id) do update set status=excluded.status,responded_at=excluded.responded_at,read_at=now(),
  schedule_version=excluded.schedule_version,response_revision=public.meeting_invitations.response_revision+1
 returning response_revision into rev;
 select not exists(select 1 from public.meeting_members m left join public.meeting_invitations i
  on i.round_id=p_round and i.profile_id=m.profile_id and i.schedule_version=p_version
  where m.series_id=s.id and coalesce(i.status,'pending')<>'available') into all_after;
 if s.status='in_progress' and (p_status='unavailable' or (all_after and not all_before)) then
  insert into public.meeting_host_notices(company_id,round_id,recipient_id,source_profile_id,schedule_version,response_revision,kind,body)
  values(r.company_id,p_round,s.host_id,auth.uid(),p_version,rev,
   case when p_status='unavailable' then 'unavailable' else 'available' end,
   case when p_status='unavailable' then (select display_name from public.profiles where id=auth.uid())||' · 참석 불가'
    else '멤버 '||(select count(*) from public.meeting_members where series_id=s.id)||'명 모두 참석 가능합니다.' end)
  on conflict do nothing;
 end if;
end $$;

alter function app.meeting_notifications() rename to meeting_notifications_before_realtime;
create function app.meeting_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'createdAt' desc),'[]'::jsonb) from (
  select value as item from jsonb_array_elements(app.meeting_notifications_before_realtime())
  union all
  select jsonb_build_object('id',n.id,'kind','meeting_invitation',
   'title',s.title||case n.kind when 'unavailable' then ' · 참석 불가 발생' else ' · 전원 참석 가능' end,
   'body',n.body,'href','/settings/profile?part=meetings&meeting='||s.id||'&round='||r.id,
   'createdAt',n.created_at,'readAt',n.read_at,
   'meeting',jsonb_build_object('role','host','roundId',r.id,'scheduleVersion',r.schedule_version,'status',n.kind))
  from public.meeting_host_notices n join public.meeting_rounds r on r.id=n.round_id join public.meeting_series s on s.id=r.series_id
  where n.recipient_id=auth.uid() and n.company_id=app.meeting_company_id() and s.host_id=auth.uid()
   and n.schedule_version=r.schedule_version and s.status='in_progress' and s.phase='published' and app.meeting_round_can_read(r.id)
 ) items;
$$;
create or replace function app.meeting_read_invitation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.meeting_invitations set read_at=coalesce(read_at,now())
  where (p_id is null or id=p_id) and profile_id=auth.uid() and company_id=app.meeting_company_id();
 update public.meeting_host_notices set read_at=coalesce(read_at,now())
  where (p_id is null or id=p_id) and recipient_id=auth.uid() and company_id=app.meeting_company_id();
end $$;

-- 타인 신청 전체 읽기 권한은 주지 않고, 회의 조율에 필요한 날짜별 요약만 반환한다.
create function app.meeting_availability(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id();
begin
 if company is null or p_date is null or cardinality(p_people) not between 1 and 200 or p_people is null then
  raise exception '회의 일정 조회 대상을 확인해 주세요.' using errcode='42501'; end if;
 if not exists(select 1 from public.meeting_series where id=p_series and company_id=company and deleted_at is null
   and (host_id=auth.uid() or created_by=auth.uid())) then raise exception '회의 조율 권한이 없습니다.' using errcode='42501'; end if;
 if exists(select 1 from unnest(p_people) x where not exists(select 1 from public.profiles where id=x and company_id=company and status='active')) then
  raise exception '같은 회사의 재직자만 조회할 수 있습니다.' using errcode='42501'; end if;
 if p_exclude_round is not null and not exists(select 1 from public.meeting_rounds where id=p_exclude_round and series_id=p_series) then
  raise exception '변경할 회차를 확인해 주세요.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(item),'[]'::jsonb) from (
  select jsonb_build_object('id',r.id::text||':'||p.id,'personId',p.id,'kind','meeting','status','approved',
   'start',to_char(r.starts_at at time zone 'Asia/Seoul','HH24:MI'),
   'end',to_char((r.starts_at+make_interval(mins=>r.duration_minutes)) at time zone 'Asia/Seoul','HH24:MI')) as item
  from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
  join public.profiles p on p.id=any(p_people) and (s.host_id=p.id or exists(select 1 from public.meeting_members m where m.series_id=s.id and m.profile_id=p.id))
  where r.company_id=company and s.deleted_at is null and r.deleted_at is null and s.phase='published' and r.confirmed_at is not null
   and r.id is distinct from p_exclude_round and (r.starts_at at time zone 'Asia/Seoul')::date=p_date
  union all
  select jsonb_build_object('id',l.id,'personId',l.employee_id,'kind',l.kind,'status',l.status,
   'start',case when l.kind='annual' then '00:00' else to_char(l.start_time,'HH24:MI') end,
   'end',case when l.kind='annual' then '24:00' else to_char(l.end_time,'HH24:MI') end)
  from public.company_leave_requests l where l.company_id=company and l.employee_id=any(p_people)
   and l.status in ('approved','pending') and l.kind in ('annual','half','quarter','offsite','remote') and p_date between l.from_date and l.to_date
 ) rows);
end $$;
create function public.list_meeting_availability(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.meeting_availability(p_series,p_date,p_people,p_exclude_round); $$;
revoke all on function app.meeting_availability(uuid,date,uuid[],uuid),app.meeting_notifications(),app.meeting_notifications_before_realtime(),public.list_meeting_availability(uuid,date,uuid[],uuid) from public,anon;
revoke all on function app.meeting_notifications_before_realtime() from authenticated;
grant execute on function app.meeting_availability(uuid,date,uuid[],uuid),app.meeting_notifications(),public.list_meeting_availability(uuid,date,uuid[],uuid) to authenticated;
-- 복제를 지원하지 않는 격리 검증 환경에서도 로직 검증을 실행한다.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.meeting_host_notices;
  alter publication supabase_realtime add table public.meeting_invitations;
 end if;
end $$;
notify pgrst,'reload schema';
