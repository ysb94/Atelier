-- 기존 회의는 공개/확정 상태를 유지한다. 새 회의만 비공개 준비 단계에서 시작한다.
alter table public.meeting_series add column phase text not null default 'published' check(phase in ('preparing','published'));
alter table public.meeting_series add column created_by uuid references public.profiles(id) default auth.uid();
update public.meeting_series set created_by=host_id where created_by is null;
alter table public.meeting_series alter column created_by set not null;
alter table public.meeting_rounds add column confirmed_at timestamptz;
alter table public.meeting_rounds add column schedule_version integer not null default 1;
update public.meeting_rounds set confirmed_at=now() where starts_at is not null;
create table public.meeting_invitations(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 round_id uuid not null references public.meeting_rounds(id),profile_id uuid not null references public.profiles(id),
 schedule_version integer not null,status text not null default 'pending' check(status in ('pending','available','unavailable')),
 sent_at timestamptz not null default now(),responded_at timestamptz,read_at timestamptz,
 unique(round_id,profile_id)
);
create index meeting_invitations_profile_idx on public.meeting_invitations(profile_id,sent_at desc);
create table public.meeting_chat_rooms(series_id uuid primary key references public.meeting_series(id),room_id uuid not null unique references public.chat_rooms(id));
create index meeting_series_creator_idx on public.meeting_series(created_by);

create or replace function app.meeting_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.meeting_series s where s.id=p_id and s.company_id=app.meeting_company_id() and s.deleted_at is null and
  (s.host_id=auth.uid() or (s.phase='preparing' and s.created_by=auth.uid()) or (s.phase='published' and (app.is_admin() or exists(select 1 from public.meeting_members m where m.series_id=s.id and m.profile_id=auth.uid())))));
$$;
create function app.meeting_round_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
 where r.id=p_id and r.deleted_at is null and app.meeting_can_read(s.id)
 and (r.confirmed_at is not null or s.host_id=auth.uid() or (s.phase='preparing' and s.created_by=auth.uid())));
$$;
drop policy meeting_rounds_read on public.meeting_rounds;
create policy meeting_rounds_read on public.meeting_rounds for select to authenticated using(app.meeting_round_can_read(id));

alter function app.meeting_list() rename to meeting_list_before_invitations;
create function app.meeting_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item || jsonb_build_object('phase',s.phase,'createdBy',s.created_by,'rounds',
  coalesce((select jsonb_agg(rj || jsonb_build_object('confirmed',r.confirmed_at is not null,'scheduleVersion',r.schedule_version,
    'responses',coalesce((select jsonb_agg(jsonb_build_object('profileId',m.profile_id,'status',coalesce(i.status,'pending'),'respondedAt',i.responded_at) order by m.profile_id)
      from public.meeting_members m left join public.meeting_invitations i on i.round_id=r.id and i.profile_id=m.profile_id and i.schedule_version=r.schedule_version where m.series_id=s.id),'[]'::jsonb)) order by r.round_no)
    from jsonb_array_elements(item->'rounds') rj join public.meeting_rounds r on r.id=(rj->>'id')::uuid where app.meeting_round_can_read(r.id)),'[]'::jsonb))),'[]'::jsonb)
 from jsonb_array_elements(app.meeting_list_before_invitations()) item join public.meeting_series s on s.id=(item->>'id')::uuid;
$$;
alter function app.meeting_calendar(date,date) rename to meeting_calendar_before_invitations;
create function app.meeting_calendar(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(app.meeting_calendar_before_invitations(p_from,p_to)) item
 join public.meeting_rounds r on r.id=(item->>'id')::uuid where r.confirmed_at is not null;
$$;

-- 기존 트랜잭션/예약 충돌 검사를 재사용하되 우회 호출은 막는다.
alter function app.meeting_save(jsonb,bigint) rename to meeting_save_before_invitations;
create function app.meeting_write(p_series jsonb,p_revision bigint,p_confirm uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare
 v_old public.meeting_series; v_id uuid:=(p_series->>'id')::uuid; v_host uuid:=(p_series#>>'{host,id}')::uuid;
 v_company uuid:=app.meeting_company_id(); v_members uuid[]; v_old_members uuid[];
 v_before public.meeting_rounds; v_after public.meeting_rounds; v_rev bigint; v_payload jsonb;
 v_member_changed boolean; v_changed boolean;
begin
 if v_company is null then raise exception '승인된 직원만 회의를 저장할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_company::text,7341));
 select * into v_old from public.meeting_series where id=v_id for update;
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
   -- 멤버에게 숨긴 다음 회차는 본문 저장 시에도 삭제·덮어쓰지 않는다.
   v_payload:=jsonb_set(v_payload,'{rounds}',(p_series->'rounds')||coalesce((select jsonb_agg(rj)
     from jsonb_array_elements(app.meeting_list_before_invitations()) item cross join jsonb_array_elements(item->'rounds') rj
     where (item->>'id')::uuid=v_id and not app.meeting_round_can_read((rj->>'id')::uuid)),'[]'::jsonb));
 end if;
 if v_old.id is null and v_host<>auth.uid() then
   v_payload:=jsonb_set(v_payload,'{members}',jsonb_build_array(jsonb_build_object('id',v_host)));
 end if;
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
end $$;
create function app.meeting_save(p_series jsonb,p_revision bigint) returns bigint language sql security definer set search_path='' as $$ select app.meeting_write(p_series,p_revision,null); $$;
create function app.meeting_confirm(p_series jsonb,p_revision bigint,p_round uuid) returns bigint language sql security definer set search_path='' as $$ select app.meeting_write(p_series,p_revision,p_round); $$;

create function app.meeting_respond(p_round uuid,p_version integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare v_round public.meeting_rounds;
begin
 select * into v_round from public.meeting_rounds where id=p_round for update;
 if not found or not app.meeting_round_can_read(p_round) or v_round.confirmed_at is null
   or not exists(select 1 from public.meeting_members where series_id=v_round.series_id and profile_id=auth.uid()) then raise exception '초대받은 멤버만 참석 여부를 답할 수 있습니다.' using errcode='42501'; end if;
 if p_version is distinct from v_round.schedule_version then raise exception '일정이 변경되었습니다. 새 일정을 확인한 뒤 답해 주세요.' using errcode='40001'; end if;
 if p_status not in ('available','unavailable') or p_status is null then raise exception '참석 가능·불가 중 선택하세요.'; end if;
 insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,status,responded_at,read_at)
 values(v_round.company_id,p_round,auth.uid(),p_version,p_status,now(),now())
 on conflict(round_id,profile_id) do update set status=excluded.status,responded_at=now(),read_at=now(),schedule_version=excluded.schedule_version;
end $$;
create function app.meeting_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind','meeting_invitation','title',s.title||' · 참석 요청',
  'body',to_char(r.starts_at at time zone 'Asia/Seoul','MM/DD HH24:MI')||' · 참석 가능·불가로 답해 주세요.',
  'href','/settings/profile?part=meetings&meeting='||s.id||'&round='||r.id,'createdAt',i.sent_at,'readAt',i.read_at) order by i.sent_at desc),'[]'::jsonb)
 from public.meeting_invitations i join public.meeting_rounds r on r.id=i.round_id join public.meeting_series s on s.id=r.series_id
 where i.profile_id=auth.uid() and i.company_id=app.meeting_company_id() and i.schedule_version=r.schedule_version and app.meeting_round_can_read(r.id);
$$;
create function app.meeting_read_invitation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.meeting_invitations i set read_at=coalesce(read_at,now()) where (p_id is null or i.id=p_id) and i.profile_id=auth.uid() and i.company_id=app.meeting_company_id();
end $$;

create function app.meeting_open_group(p_series uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; v_room uuid; v_ids uuid[];
begin
 select * into s from public.meeting_series where id=p_series for update;
 if not found or not app.meeting_can_read(s.id) or s.phase<>'published' or not(s.host_id=auth.uid() or exists(select 1 from public.meeting_members where series_id=s.id and profile_id=auth.uid())) then
   raise exception '확정된 회의의 호스트·멤버만 단체 대화를 열 수 있습니다.' using errcode='42501'; end if;
 select array_agg(distinct id) into v_ids from (select s.host_id as id union select profile_id from public.meeting_members where series_id=s.id) people;
 perform app.assert_chat_member_profiles(v_ids);
 select room_id into v_room from public.meeting_chat_rooms where series_id=s.id;
 if v_room is null then
   v_room:=public.create_group_chat(left('회의 · '||s.title,80),v_ids);
   insert into public.meeting_chat_rooms(series_id,room_id) values(s.id,v_room);
 end if;
 -- 회의에서 제외된 사람에게 새 대화가 노출되지 않도록 회의 전용 방의 멤버를 맞춘다.
 delete from public.chat_room_members where room_id=v_room and not profile_id=any(v_ids);
 insert into public.chat_room_members(room_id,profile_id) select v_room,id from unnest(v_ids) id on conflict(room_id,profile_id) do nothing;
 return v_room;
end $$;

create or replace function app.meeting_file_access(p_path text,p_action text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.meeting_files f join public.meeting_rounds r on r.id=f.round_id join public.meeting_series s on s.id=r.series_id
 where f.storage_path=p_path and f.company_id=app.meeting_company_id() and case p_action
 when 'read' then f.ready and f.deleted_at is null and app.meeting_round_can_read(r.id)
 when 'insert' then not f.ready and f.deleted_at is null and f.uploaded_by=auth.uid() and app.meeting_round_can_read(r.id)
 when 'delete' then f.deleted_at is not null and ((f.uploaded_by=auth.uid() and app.meeting_round_can_read(r.id)) or s.host_id=auth.uid() or app.is_admin()) else false end);
$$;
alter function app.meeting_begin_file(uuid,text,text,bigint) rename to meeting_begin_file_before_invitations;
create function app.meeting_begin_file(p_round uuid,p_name text,p_type text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app.meeting_round_can_read(p_round) then raise exception '회의 자료를 올릴 권한이 없습니다.' using errcode='42501'; end if;
 return app.meeting_begin_file_before_invitations(p_round,p_name,p_type,p_size);
end $$;

alter table public.meeting_invitations enable row level security;
alter table public.meeting_chat_rooms enable row level security;
create policy meeting_invitations_read on public.meeting_invitations for select to authenticated using(company_id=(select app.meeting_company_id()) and app.meeting_round_can_read(round_id));
create policy meeting_chat_rooms_read on public.meeting_chat_rooms for select to authenticated using(app.meeting_can_read(series_id) and exists(select 1 from public.chat_room_members m where m.room_id=meeting_chat_rooms.room_id and m.profile_id=(select auth.uid())));
revoke all on public.meeting_invitations,public.meeting_chat_rooms from anon,authenticated;
grant select on public.meeting_invitations,public.meeting_chat_rooms to authenticated;
create function public.confirm_company_meeting(p_series jsonb,p_revision bigint,p_round uuid) returns bigint language sql security invoker set search_path='' as $$ select app.meeting_confirm(p_series,p_revision,p_round); $$;
create function public.respond_to_meeting(p_round uuid,p_version integer,p_status text) returns void language sql security invoker set search_path='' as $$ select app.meeting_respond(p_round,p_version,p_status); $$;
create function public.list_my_meeting_invitations() returns jsonb language sql stable security invoker set search_path='' as $$ select app.meeting_notifications(); $$;
create function public.read_meeting_invitation(p_id uuid) returns void language sql security invoker set search_path='' as $$ select app.meeting_read_invitation(p_id); $$;
create function public.open_meeting_group(p_series uuid) returns uuid language sql security invoker set search_path='' as $$ select app.meeting_open_group(p_series); $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='app' and p.proname like 'meeting_%') or (n.nspname='public' and p.proname in ('confirm_company_meeting','respond_to_meeting','list_my_meeting_invitations','read_meeting_invitation','open_meeting_group')) loop
  execute format('revoke all on function %s from public,anon',r.signature);
  if r.proname like '%_before_invitations' or r.proname='meeting_write' then execute format('revoke execute on function %s from authenticated',r.signature);
  else execute format('grant execute on function %s to authenticated',r.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
