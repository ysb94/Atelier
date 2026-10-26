-- 회의 기록·직원·전역 권한은 변경하지 않는다. 기존 참석 응답·자료·대화 권한은 유지한다.
-- 기존 점심 예약을 일괄 수정하지 않으며 새로운 예약 또는 일정 변경에 적용한다.
CREATE OR REPLACE FUNCTION app.meeting_write(p_series jsonb, p_revision bigint, p_confirm uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_old public.meeting_series; v_id uuid:=(p_series->>'id')::uuid; v_host uuid:=(p_series#>>'{host,id}')::uuid;
 v_company uuid:=app.meeting_company_id(); v_members uuid[]; v_old_members uuid[];
 v_before public.meeting_rounds; v_after public.meeting_rounds; v_rev bigint; v_payload jsonb;
 v_member_changed boolean; v_changed boolean; v_lunch_start time; v_lunch_end time;
begin
 if v_company is null then raise exception '승인된 직원만 회의를 저장할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_company::text,7341));
 select * into v_old from public.meeting_series where id=v_id for update;
 if v_old.id is not null and v_old.host_id<>auth.uid() then
   raise exception '호스트만 회의를 수정할 수 있습니다.' using errcode='42501';
 end if;
 if v_old.id is not null and (not app.meeting_can_read(v_id) or v_old.revision is distinct from p_revision) then
   if not app.meeting_can_read(v_id) then raise exception '회의 수정 권한이 없습니다.' using errcode='42501'; end if;
   raise exception '다른 사람이 회의를 수정했습니다. 새로고침해 주세요.' using errcode='40001';
 end if;
 if not exists(select 1 from public.profiles where id=v_host and company_id=v_company and status='active') then raise exception '같은 회사의 재직자를 호스트로 선택하세요.' using errcode='42501'; end if;
 select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}'::uuid[]) into v_members from jsonb_array_elements(p_series->'members') x;
 if jsonb_typeof(p_series->'members') is distinct from 'array' or cardinality(v_members)>200 or (v_old.id is null and cardinality(v_members)=0) then raise exception '회의 멤버를 추가하고 확인해 주세요.'; end if;
 if v_host=any(v_members) then raise exception '호스트는 멤버에 중복 등록할 수 없습니다.'; end if;
 if exists(select 1 from unnest(v_members) id where not exists(select 1 from public.profiles p where p.id=id and p.company_id=v_company and p.status='active')) then raise exception '같은 회사의 재직자를 멤버로 선택하세요.' using errcode='42501'; end if;
 select coalesce(array_agg(profile_id order by profile_id),'{}'::uuid[]) into v_old_members from public.meeting_members where series_id=v_id;
 v_member_changed:=v_members is distinct from v_old_members;
 if v_old.id is not null then
   if v_old.phase='published' and v_host<>v_old.host_id then raise exception '확정 후에는 호스트를 변경할 수 없습니다.' using errcode='42501'; end if;
   if v_old.host_id<>auth.uid() and not (v_old.phase='preparing' and v_old.created_by=auth.uid()) and (
     v_member_changed or v_host<>v_old.host_id or v_old.title is distinct from btrim(p_series->>'title')
     or exists(select 1 from jsonb_array_elements(p_series->'rounds') x left join public.meeting_rounds r on r.id=(x->>'id')::uuid
       where r.id is null or r.starts_at is distinct from (nullif(x->>'startsAt','')::timestamp at time zone 'Asia/Seoul')
       or r.room_id is distinct from nullif(x->>'roomId','') or r.duration_minutes is distinct from coalesce((x->>'durationMinutes')::integer,(p_series->>'durationMinutes')::integer))
   ) then raise exception '호스트만 회의 구성과 일정을 변경할 수 있습니다.' using errcode='42501'; end if;
 end if;
 if p_confirm is not null and v_host<>auth.uid() then raise exception '호스트만 일정을 확정할 수 있습니다.' using errcode='42501'; end if;
 if exists(select 1 from public.meeting_rounds r join jsonb_array_elements(p_series->'rounds') x on r.id=(x->>'id')::uuid
   where r.series_id=v_id and r.confirmed_at is not null and (
    r.starts_at is distinct from (nullif(x->>'startsAt','')::timestamp at time zone 'Asia/Seoul') or r.room_id is distinct from nullif(x->>'roomId','')
    or r.duration_minutes is distinct from coalesce((x->>'durationMinutes')::integer,(p_series->>'durationMinutes')::integer)) and r.id is distinct from p_confirm)
   or (v_old.phase='published' and v_member_changed and p_confirm is null) then raise exception '일정 변경은 일정 확정에서 진행해 주세요.'; end if;
 select * into v_before from public.meeting_rounds where id=p_confirm and series_id=v_id;
 v_payload:=jsonb_set(p_series,'{host,id}',to_jsonb(coalesce(v_old.host_id,auth.uid())::text));
 if v_old.phase='published' and v_old.host_id<>auth.uid() then
   if exists(select 1 from jsonb_array_elements(p_series->'rounds') x where not app.meeting_round_can_read((x->>'id')::uuid)) then raise exception '공개된 회차만 수정할 수 있습니다.' using errcode='42501'; end if;
   v_payload:=jsonb_set(v_payload,'{rounds}',(p_series->'rounds')||coalesce((select jsonb_agg(rj)
     from jsonb_array_elements(app.meeting_list_before_invitations()) item cross join jsonb_array_elements(item->'rounds') rj
     where (item->>'id')::uuid=v_id and not app.meeting_round_can_read((rj->>'id')::uuid)),'[]'::jsonb));
 end if;
 if v_old.id is null and v_host<>auth.uid() then
   v_payload:=jsonb_set(v_payload,'{members}',jsonb_build_array(jsonb_build_object('id',v_host)));
 end if;
 -- 기존 예약은 유지한다. 새 예약·시간/회의실 변경·일정 확정 시에만 점심 겹침을 차단한다.
 select coalesce((select h.lunch_start from public.company_work_hours h where h.company_id=v_company),time '12:00'),
        coalesce((select h.lunch_end from public.company_work_hours h where h.company_id=v_company),time '13:00')
 into v_lunch_start,v_lunch_end;
 if exists(
   select 1 from jsonb_array_elements(p_series->'rounds') x
   left join public.meeting_rounds r on r.id=(x->>'id')::uuid and r.series_id=v_id
   cross join lateral (select nullif(x->>'startsAt','')::timestamp as starts,
     coalesce((x->>'durationMinutes')::integer,(p_series->>'durationMinutes')::integer) as minutes) candidate
   where candidate.starts is not null
     and (r.id is null or r.id=p_confirm or r.starts_at is distinct from (candidate.starts at time zone 'Asia/Seoul')
       or r.room_id is distinct from nullif(x->>'roomId','') or r.duration_minutes is distinct from candidate.minutes)
     and candidate.starts < candidate.starts::date+v_lunch_end
     and candidate.starts+make_interval(mins=>candidate.minutes) > candidate.starts::date+v_lunch_start
 ) then raise exception '회사 점심시간 %–%에는 회의를 예약할 수 없습니다.',to_char(v_lunch_start,'HH24:MI'),to_char(v_lunch_end,'HH24:MI') using errcode='23514'; end if;
 v_rev:=app.meeting_save_before_invitations(v_payload,p_revision);
 if v_old.id is null and v_host<>auth.uid() then
   delete from public.meeting_members where series_id=v_id;
   insert into public.meeting_members(company_id,series_id,profile_id) select v_company,v_id,id from unnest(v_members) id;
 end if;
 update public.meeting_series set host_id=v_host,phase=coalesce(v_old.phase,'preparing') where id=v_id;
 if p_confirm is not null then
   select * into v_after from public.meeting_rounds where id=p_confirm and series_id=v_id and deleted_at is null;
   if not found or v_after.starts_at is null then raise exception '날짜와 시간을 선택한 회차만 확정할 수 있습니다.'; end if;
   v_changed:=v_before.confirmed_at is null or v_before.starts_at is distinct from v_after.starts_at or v_before.room_id is distinct from v_after.room_id
     or v_before.duration_minutes is distinct from v_after.duration_minutes or v_member_changed;
   update public.meeting_series set phase='published' where id=v_id;
   if v_changed then
     update public.meeting_rounds set confirmed_at=now(),schedule_version=case when v_before.confirmed_at is null then 1 else schedule_version+1 end where id=p_confirm returning * into v_after;
     insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version)
       select v_company,p_confirm,x,v_after.schedule_version from unnest(v_members) x
       on conflict(round_id,profile_id) do update set status='pending',schedule_version=excluded.schedule_version,sent_at=now(),responded_at=null,read_at=null;
     delete from public.meeting_invitations where round_id=p_confirm and not profile_id=any(v_members);
     if v_member_changed and exists(select 1 from public.meeting_chat_rooms where series_id=v_id) then perform app.meeting_open_group(v_id); end if;
   end if;
 end if;
 return v_rev;
end $function$;

CREATE OR REPLACE FUNCTION app.meeting_delete(p_id uuid, p_revision bigint)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.meeting_series; v_paths text[];
begin
  select * into v_row from public.meeting_series where id=p_id for update;
  if not found or v_row.company_id is distinct from app.meeting_company_id() or v_row.deleted_at is not null
    or v_row.host_id<>auth.uid() then raise exception '회의 삭제 권한이 없습니다.' using errcode='42501'; end if;
  if v_row.revision is distinct from p_revision then raise exception '다른 사람이 회의를 수정했습니다. 새로고침해 주세요.' using errcode='40001'; end if;
  select coalesce(array_agg(f.storage_path),'{}'::text[]) into v_paths from public.meeting_files f
    join public.meeting_rounds r on r.id=f.round_id where r.series_id=p_id;
  update public.meeting_series set deleted_at=now(),deleted_by=auth.uid(),revision=revision+1,updated_at=now() where id=p_id;
  update public.meeting_files set deleted_at=now() where round_id in (select id from public.meeting_rounds where series_id=p_id) and deleted_at is null;
  return v_paths;
end $function$;
