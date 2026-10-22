-- 여러 날짜에 걸친 외근·재택은 첫날 시작부터 마지막 날 종료까지의 연속 구간이다.
create or replace function app.meeting_availability(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid) returns jsonb
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
   'start',case when l.kind='annual' or (l.kind in ('offsite','remote') and p_date>l.from_date) then '00:00' else to_char(l.start_time,'HH24:MI') end,
   'end',case when l.kind='annual' or (l.kind in ('offsite','remote') and p_date<l.to_date) then '24:00' else to_char(l.end_time,'HH24:MI') end)
  from public.company_leave_requests l where l.company_id=company and l.employee_id=any(p_people)
   and l.status in ('approved','pending') and l.kind in ('annual','half','quarter','offsite','remote') and p_date between l.from_date and l.to_date
 ) rows);
end $$;
