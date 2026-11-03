-- 회의 단체방은 메시지 없이 생성한다. 실제 글·파일 전송부터 기존 읽지 않음 집계가 동작한다.
-- 일반 단체방 생성, 기존 대화·읽음 이력, 회의 참석/호스트 알림은 변경하지 않는다.
create or replace function app.meeting_open_group(p_series uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; v_room uuid; v_ids uuid[];
begin
 select * into s from public.meeting_series where id=p_series for update;
 if not found or not app.meeting_can_read(s.id) or s.phase<>'published' or not(s.host_id=auth.uid() or exists(select 1 from public.meeting_members where series_id=s.id and profile_id=auth.uid())) then
   raise exception '확정된 회의의 호스트·멤버만 단체 대화를 열 수 있습니다.' using errcode='42501'; end if;
 select array_agg(distinct id) into v_ids from (select s.host_id as id union select profile_id from public.meeting_members where series_id=s.id) people;
 perform app.assert_chat_member_profiles(v_ids);
 select room_id into v_room from public.meeting_chat_rooms where series_id=s.id;
 if v_room is null then
   -- create_group_chat의 회사·활성 직원 검사는 위 assert에서 유지하고 인원 제한도 그대로 둔다.
   if cardinality(array_remove(v_ids,auth.uid()))>100 then
     raise exception '한 방에 초대할 수 있는 사람은 100명까지입니다.'; end if;
   insert into public.chat_rooms(company_id,kind,name,created_by)
   values(app.chat_company_id(),'group',btrim(left('회의 · '||s.title,80)),auth.uid()) returning id into v_room;
   insert into public.meeting_chat_rooms(series_id,room_id) values(s.id,v_room);
 end if;
 -- 기존 방을 재사용하고 현재 회의 멤버만 접근한다. 읽음 시각은 임의로 변경하지 않는다.
 delete from public.chat_room_members where room_id=v_room and not profile_id=any(v_ids);
 insert into public.chat_room_members(room_id,profile_id) select v_room,id from unnest(v_ids) id on conflict(room_id,profile_id) do nothing;
 return v_room;
end $$;
