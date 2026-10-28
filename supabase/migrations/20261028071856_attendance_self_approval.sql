begin;
-- 기존 행은 갱신하지 않으며 지정 내역과 기존 처리자·처리 시각 열을 유지한다.
CREATE OR REPLACE FUNCTION app.guard_company_leave_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype; starts timestamp; ends timestamp; minutes integer;
  today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null then raise exception '재직 중인 직원만 신청할 수 있습니다.'; end if;
  if TG_OP = 'INSERT' then
    if new.employee_id <> actor.id then raise exception '본인 신청만 등록할 수 있습니다.'; end if;
    new.company_id := actor.company_id;
    new.employee_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
    new.department_id := actor.department_id;
    select coalesce(d.name, '소속 없음') into new.department_name from public.departments d where d.id = actor.department_id;
    new.department_name := coalesce(new.department_name, '소속 없음');
    new.created_at := now();
    new.note := btrim(new.note);
    new.place := case when new.kind in ('offsite','remote') then btrim(coalesce(new.place, '')) else '' end;
    if new.kind = 'remote' then raise exception '재택은 등록할 수 없습니다.'; end if;
    if new.kind = 'official' and new.note = '' then raise exception '공가 사유를 입력해 주세요.'; end if;
    if new.kind in ('annual','half','quarter','offsite') then
      new.status := 'approved';
      new.decided_at := now();
      new.decided_by := null;
      new.decided_by_name := null;
      new.decision_note := null;
    else
      new.status := 'pending';
      new.decided_at := null; new.decided_by := null; new.decided_by_name := null; new.decision_note := null;
    end if;
    if new.kind='overtime' and (new.from_date<>new.to_date or new.end_time<=new.start_time or new.note='') then
      raise exception '야근은 날짜별로 시작·종료 시각과 사유를 입력해 주세요.';
    end if;
    if new.kind = 'offsite' and new.place = '' then raise exception '외근 장소를 입력해 주세요.'; end if;
    if new.kind = 'correction' then
      if new.from_date <> new.to_date or new.end_time <= new.start_time or new.note = '' then
        raise exception '출퇴근 정정은 날짜별로 실제 출근·퇴근 시각과 사유를 입력해 주세요.';
      end if;
      if new.from_date > today then raise exception '앞으로의 날짜는 출퇴근 정정을 신청할 수 없습니다.'; end if;
    end if;
    if new.kind in ('half','quarter') then
      minutes := extract(epoch from (new.end_time - new.start_time)) / 60
        - greatest(0, extract(epoch from (least(new.end_time, time '13:00') - greatest(new.start_time, time '12:00'))) / 60);
      if new.start_time < time '09:00' or new.end_time > time '18:00'
        or minutes <> (case when new.kind = 'half' then 240 else 120 end) then
        raise exception '반차는 4시간, 반반차는 2시간으로 신청해 주세요. 휴게시간 12–13시는 제외합니다.';
      end if;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text, 0));
    if new.kind = 'correction' then
      if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.kind = 'correction'
        and r.status = 'pending' and r.from_date = new.from_date) then
        raise exception '같은 날짜에 승인 대기 중인 출퇴근 정정 신청이 있습니다.';
      end if;
    else
      starts := new.from_date + case when new.kind in ('annual','official') then time '00:00' else new.start_time end;
      ends := case when new.kind in ('annual','official') then new.to_date + interval '1 day' else new.to_date + new.end_time end;
      if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.status in ('pending','approved')
        and r.kind <> 'correction'
        and not ((r.kind in ('offsite','remote') and new.kind in ('half','quarter','overtime'))
          or (new.kind in ('offsite','remote') and r.kind in ('half','quarter','overtime')))
        and tsrange(r.from_date + case when r.kind in ('annual','official') then time '00:00' else r.start_time end,
          case when r.kind in ('annual','official') then r.to_date + interval '1 day' else r.to_date + r.end_time end, '[)')
          && tsrange(starts, ends, '[)')) then
        raise exception '같은 시간에 대기 중이거나 승인된 신청이 있습니다.';
      end if;
    end if;
  else
    if row(new.id,new.company_id,new.employee_id,new.employee_name,new.department_id,new.department_name,new.kind,new.from_date,new.to_date,new.start_time,new.end_time,new.note,new.place,new.created_at)
      is distinct from row(old.id,old.company_id,old.employee_id,old.employee_name,old.department_id,old.department_name,old.kind,old.from_date,old.to_date,old.start_time,old.end_time,old.note,old.place,old.created_at) then
      raise exception '신청 원본은 수정할 수 없습니다. 대기 신청을 취소하고 다시 신청해 주세요.';
    end if;
    if old.status <> 'pending' and not (
      old.status = 'approved' and old.kind in ('annual','half','quarter','offsite') and new.status = 'cancelled' and actor.id = old.employee_id
    ) then raise exception '이미 처리된 신청입니다. 목록을 새로고침해 주세요.'; end if;
    if new.status = 'cancelled' then
      if actor.id <> old.employee_id then raise exception '본인 신청만 취소할 수 있습니다.'; end if;
      new.decision_note := null;
    elsif new.status in ('approved','rejected') then
      if old.kind not in ('overtime','correction','official') then raise exception '이 항목은 승인 없이 등록됩니다.'; end if;
      if old.kind = 'official' then
        if not app.can_edit_org_assignment() then raise exception '공가 서류는 운영지원만 처리할 수 있습니다.'; end if;
        if new.status = 'approved' and not exists(select 1 from public.company_leave_files f where f.request_id = old.id and f.ready) then
          raise exception '공가 서류가 없으면 처리할 수 없습니다.';
        end if;
      elsif not app.is_department_request_approver(old.company_id,old.department_id,old.kind) then
        raise exception '이 부서와 신청 종류의 지정 승인자만 처리할 수 있습니다.';
      end if;
      if actor.id = old.employee_id and (old.kind not in ('overtime','correction') or new.status <> 'approved') then
        raise exception '본인 처리는 지정된 야근·출퇴근 정정의 승인만 가능합니다.';
      end if;
      new.decision_note := nullif(btrim(new.decision_note), '');
      if new.status = 'rejected' and new.decision_note is null then raise exception '반려 사유를 입력해 주세요.'; end if;
    else raise exception '올바른 처리 상태가 아닙니다.';
    end if;
    new.decided_at := now(); new.decided_by := actor.id;
    new.decided_by_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
  end if;
  return new;
end;
$function$;

alter policy leave_transition on public.company_leave_requests using (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.status = 'active'::text)))) AND (((status = 'pending'::text) AND ((employee_id = ( SELECT auth.uid() AS uid)) OR app.is_department_request_approver(company_id, department_id, kind) OR ((kind = 'official'::text) AND app.can_edit_org_assignment()))) OR ((status = 'approved'::text) AND (kind = ANY (ARRAY['annual'::text, 'half'::text, 'quarter'::text, 'offsite'::text])) AND (employee_id = ( SELECT auth.uid() AS uid)))))) with check (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.status = 'active'::text)))) AND ((employee_id = ( SELECT auth.uid() AS uid)) OR app.is_department_request_approver(company_id, department_id, kind) OR ((kind = 'official'::text) AND app.can_edit_org_assignment()))));
create or replace function public.list_my_approval_requests() returns setof public.company_leave_requests language sql stable set search_path='' as $$
 select r.* from public.company_leave_requests r
 where (r.kind in ('overtime','correction') and app.is_department_request_approver(r.company_id,r.department_id,r.kind))
    or (r.status <> 'pending' and r.decided_by=(select auth.uid()))
 order by r.created_at desc,r.id;
$$;
commit;
