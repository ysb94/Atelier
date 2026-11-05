-- Local preparation only. Shared DB application requires separate approval.
do $$ begin
 if exists(select 1 from (values
  ('app.clock_out_today()','5c90c9e1b5cec00ade3ee40df7c59691'),
  ('app.undo_clock_out_today()','4e3bf8a9bb2e6fb00546ebc13915194b'),
  ('app.undo_clock_out_today_original()','aec228f9ed05c26542949bb8d8ef5ad1'),
  ('app.guard_overtime_actual()','5b6234acf2bf74ca2623e0d032c3eb92')
 ) baseline(signature,hash) where md5(pg_get_functiondef(to_regprocedure(signature))) is distinct from hash) then
  raise exception 'Attendance function changed; revalidate checkout linkage';
 end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='company_leave_requests' and cmd in('SELECT','ALL'))<>1
  or not exists(select 1 from pg_policies where schemaname='public' and tablename='company_leave_requests'
  and policyname='leave_read' and cmd='SELECT' and permissive='PERMISSIVE' and roles=array['authenticated']::name[]
  and md5(qual)='8402012fac5ebef3657a579559383740') then
  raise exception 'Request read policy changed; revalidate overtime read boundary';
 end if;
end $$;

-- Null for every existing clock: never rewrite historical manual reports.
alter table public.attendance_clock_ins add column overtime_linked_at timestamptz;
create function app.mark_overtime_checkout() returns trigger language plpgsql set search_path='' as $$
begin
 if new.clock_out_at is not null and (TG_OP='INSERT' or new.clock_out_at is distinct from old.clock_out_at)
  and (coalesce(new.clock_out_source,'manual')='manual' or new.clock_out_reported_at is not null) then
  new.overtime_linked_at:=clock_timestamp();
 end if;
 return new;
end $$;
revoke all on function app.mark_overtime_checkout() from public,anon,authenticated;
create trigger mark_overtime_checkout before insert or update of clock_out_at on public.attendance_clock_ins
 for each row execute function app.mark_overtime_checkout();

-- Same request read boundary as leave_read; no new raw attendance access.
create function app.overtime_clock_state(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();r public.company_leave_requests; c public.attendance_clock_ins;
 fix public.company_leave_requests; ends timestamptz; starts timestamptz; boundary timestamptz;checkout timestamptz;legacy_saved timestamptz;
begin
 select * into r from public.company_leave_requests where id=p_request;
 if actor is null or not found or not exists(select 1 from public.profiles p where p.id=actor and p.status='active' and p.company_id=r.company_id)
  or not coalesce((r.employee_id=actor or app.can_edit_org_assignment() or r.decided_by=actor
    or app.is_department_request_approver(r.company_id,r.department_id,r.kind) or r.company_id=app.company_review_company_id()),false) then
  raise exception '이 야근을 확인할 권한이 없습니다.' using errcode='42501';
 end if;
 if r.kind<>'overtime' then return jsonb_build_object('linked',false);end if;
 select * into c from public.attendance_clock_ins where employee_id=r.employee_id and company_id=r.company_id and work_date=r.from_date;
 if not found then return jsonb_build_object('linked',false);end if;
 select * into fix from public.company_leave_requests f where f.employee_id=r.employee_id and f.company_id=r.company_id
  and f.kind='correction' and f.status='approved' and f.from_date=r.from_date order by f.created_at desc,f.id desc limit 1;
 select saved_at into legacy_saved from public.overtime_actual_reports where request_id=r.id order by revision desc limit 1;
 -- Existing manual reports win until a new checkout or a newer effective correction.
 -- Unreported real historical checkouts can be linked without rewriting a row.
 if c.overtime_linked_at is null and legacy_saved is not null
  and not coalesce(coalesce(fix.decided_at,fix.created_at)>greatest(legacy_saved,coalesce(c.offsite_returned_at,'-infinity'::timestamptz)),false) then
  return jsonb_build_object('linked',false);
 end if;
 starts:=(r.from_date+r.start_time) at time zone 'Asia/Seoul';
 ends:=case when coalesce(c.clock_out_source,'manual')='manual' then c.clock_out_at else null end;
 if fix.id is not null and coalesce(fix.decided_at,fix.created_at)>coalesce(c.offsite_returned_at,'-infinity'::timestamptz) then
  ends:=((r.from_date+fix.end_time+case when fix.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul');
 end if;
 if ends>clock_timestamp() then ends:=null;end if;
 checkout:=ends;
 -- Preserve separate holiday/offsite settlement paths and avoid duplicate hours.
 if ends is not null and exists(select 1 from public.offsite_settlements s join public.company_leave_requests o on o.id=s.request_id
  where o.employee_id=r.employee_id and o.company_id=r.company_id and ends>starts
   and tstzrange(starts,ends,'[)') && tstzrange((o.from_date+o.start_time) at time zone 'Asia/Seoul',app.offsite_finish(o,o.to_date),'[)')) then
  ends:=null;
 end if;
 if ends is not null and ends>starts then
  select min(d at time zone 'Asia/Seoul') into boundary from generate_series(r.from_date::timestamp,(ends at time zone 'Asia/Seoul')::date::timestamp,interval '1 day')d
   where extract(isodow from d)>5 or exists(select 1 from app.leave_balance_holidays h where h.day=d::date);
  if boundary is not null then ends:=greatest(starts,least(ends,boundary));end if;
  select min((n.from_date+n.start_time) at time zone 'Asia/Seoul') into boundary from public.company_leave_requests n
   where n.employee_id=r.employee_id and n.company_id=r.company_id and n.kind='overtime' and n.status='approved'
    and n.from_date=r.from_date and n.start_time>r.start_time;
  if boundary is not null then ends:=least(ends,boundary);end if;
 end if;
 if ends>clock_timestamp() then ends:=null;end if;
 return jsonb_build_object('linked',true,'end_at',ends,'checkout_at',checkout,'recorded_at',coalesce(fix.decided_at,c.overtime_linked_at,c.clock_out_reported_at,c.clock_out_at));
end $$;
revoke all on function app.overtime_clock_state(uuid) from public,anon;
grant execute on function app.overtime_clock_state(uuid) to authenticated;

create view public.overtime_actual_with_checkout with(security_invoker=true) as
with legacy as materialized (
 select distinct on(request_id) * from public.overtime_actual_reports order by request_id,revision desc
), requests as materialized (
 select r.*,app.overtime_clock_state(r.id) clock from public.company_leave_requests r where r.kind='overtime'
)
select l.request_id,l.revision,l.start_at,l.end_at,l.break_minutes,l.saved_at,false clock_linked,null::timestamptz checkout_at
 from legacy l join requests r on r.id=l.request_id where not (r.clock->>'linked')::boolean
union all
select r.id,coalesce(l.revision,0::bigint),(r.from_date+r.start_time) at time zone 'Asia/Seoul',
 (r.clock->>'end_at')::timestamptz,0,(r.clock->>'recorded_at')::timestamptz,true,(r.clock->>'checkout_at')::timestamptz
 from requests r left join legacy l on l.request_id=r.id
 where r.status='approved' and r.from_date=r.to_date and (r.clock->>'linked')::boolean and r.clock->>'end_at' is not null
 and not exists(select 1 from requests earlier where earlier.status='approved' and earlier.employee_id=r.employee_id
  and earlier.from_date=r.from_date and earlier.start_time=r.start_time and (earlier.created_at,earlier.id)<(r.created_at,r.id));
revoke all on public.overtime_actual_with_checkout from public,anon,authenticated;
grant select on public.overtime_actual_with_checkout to authenticated;

-- Keep manual API compatibility, ownership, CAS and append-only history.
create or replace function app.guard_overtime_actual() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.company_leave_requests;current_revision bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.company_leave_requests where id=new.request_id;
 if not found or r.employee_id is distinct from auth.uid() or r.kind<>'overtime' or r.status<>'approved'
  or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id=r.company_id) then
  raise exception '본인의 승인된 야근에만 실제 시간을 입력할 수 있습니다.' using errcode='42501';end if;
 if r.from_date<>r.to_date or new.end_at>clock_timestamp() or new.start_at<>date_trunc('minute',new.start_at) or new.end_at<>date_trunc('minute',new.end_at)
  or (new.start_at at time zone 'Asia/Seoul')::date<>r.from_date then
  raise exception '근무일의 실제 시각을 분 단위로 입력해 주세요. 미래 시간은 등록할 수 없습니다.' using errcode='23514';end if;
 select coalesce(max(revision),0) into current_revision from public.overtime_actual_reports where request_id=r.id;
 if new.revision<>current_revision+1 then raise exception '기록이 변경됐습니다. 다시 불러와 주세요.' using errcode='40001';end if;
 new.saved_at:=clock_timestamp();return new;
end $$;
notify pgrst,'reload schema';

create or replace function app.undo_clock_out_today_original() returns void language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=auth.uid();company uuid;today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;record public.attendance_clock_ins;
begin
 if actor is null then raise exception '로그인이 필요합니다.';end if;
 select company_id into company from public.profiles where id=actor and status='active';
 if company is null then raise exception '재직 중인 직원만 퇴근을 취소할 수 있습니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 select * into record from public.attendance_clock_ins where employee_id=actor and company_id=company and work_date=today for update;
 if not found then
  select c.* into record from public.attendance_clock_ins c where c.employee_id=actor and c.company_id=company and c.work_date=today-1
   and c.clock_out_at is not null and c.overtime_linked_at is not null
   and clock_timestamp()<((today+app.attendance_start_for_date(actor,today)) at time zone 'Asia/Seoul')
   and exists(select 1 from public.company_leave_requests r where r.employee_id=actor and r.company_id=company and r.kind='overtime'
    and r.status in('pending','approved') and r.from_date=c.work_date and r.to_date=c.work_date) for update;
 end if;
 if not found or record.clock_out_at is null then raise exception '취소할 오늘 퇴근 기록이 없습니다.';end if;
 update public.attendance_clock_ins set clock_out_at=null where id=record.id;
end $$;

CREATE OR REPLACE FUNCTION app.clock_out_today()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
declare
  actor uuid := auth.uid();
  company uuid;
  today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  record public.attendance_clock_ins%rowtype;
  stamp timestamptz;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id = actor and status = 'active';
  if company is null then raise exception '재직 중인 직원만 퇴근을 기록할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into record from public.attendance_clock_ins
    where employee_id = actor and company_id = company and work_date = today for update;
  if not found then
    select c.* into record from public.attendance_clock_ins c
      where c.employee_id=actor and c.company_id=company and c.work_date<today
        and c.clock_out_at is null and c.auto_closed_at is null
        and (exists(select 1 from public.company_leave_requests r where r.employee_id=actor and r.company_id=company
          and r.kind='offsite' and r.status='approved' and (r.offsite_continuous or (r.end_next_day and r.to_date=c.work_date and c.work_date=today-1)) and r.from_date=c.work_date) or (c.work_date=today-1 and clock_timestamp()<((today+app.attendance_start_for_date(actor,today)) at time zone 'Asia/Seoul') and exists(select 1 from public.company_leave_requests r where r.employee_id=actor and r.company_id=company and r.kind='overtime' and r.status in('pending','approved') and r.from_date=c.work_date and r.to_date=c.work_date)))
      order by c.work_date desc limit 1 for update;
  end if;
  if not found then raise exception '오늘 출근 기록이 없습니다. 출근을 먼저 기록해 주세요.'; end if;
  if record.clock_out_at is not null then return record.clock_out_at; end if;
  -- 잠금을 얻은 뒤 서버 시각을 계산한다. 브라우저 시각/사용자/날짜를 인자로 받지 않는다.
  stamp := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  if stamp < ((record.work_date + record.clock_in) at time zone 'Asia/Seoul') then
    raise exception '퇴근 시각이 출근 시각보다 빠릅니다. 출근 기록을 확인해 주세요.';
  end if;
  update public.attendance_clock_ins set clock_out_at = stamp, clock_out_source='manual' where id = record.id;
  return stamp;
end;
$function$;
revoke all on function app.undo_clock_out_today_original() from public,anon,authenticated;
revoke all on function app.clock_out_today() from public,anon;
grant execute on function app.clock_out_today() to authenticated;
