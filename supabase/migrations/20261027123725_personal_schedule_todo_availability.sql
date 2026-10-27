-- 개인 To-do 원본은 본인만 접근한다. 기존 사용자·근태·회의 데이터/정책은 변경하지 않는다.
create table public.personal_schedule_todos (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 owner_id uuid not null references public.profiles(id),
 client_id text not null check(length(client_id) between 1 and 200),
 date date not null,
 title text not null check(length(btrim(title)) between 1 and 160),
 start_time time,
 end_time time,
 important boolean not null default false,
 done boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique(owner_id,client_id),
 constraint personal_schedule_todo_time_range check (
  (start_time is null and end_time is null and not important)
  or (start_time is not null and end_time is not null and start_time < end_time
   and extract(second from start_time)=0 and extract(second from end_time)=0)
 )
);
create index personal_schedule_todos_owner_date on public.personal_schedule_todos(owner_id,date) where deleted_at is null;
create index personal_schedule_todos_busy on public.personal_schedule_todos(company_id,date,owner_id)
 where important and not done and deleted_at is null;
alter table public.personal_schedule_todos enable row level security;
revoke all on public.personal_schedule_todos from public,anon;
grant select,insert,update on public.personal_schedule_todos to authenticated;
create policy personal_schedule_todos_self on public.personal_schedule_todos for all to authenticated
 using(owner_id=(select auth.uid()) and company_id=(select app.meeting_company_id()))
 with check(owner_id=(select auth.uid()) and company_id=(select app.meeting_company_id()));

create function app.personal_schedule_todo_stamp() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
  or new.company_id is distinct from old.company_id or new.client_id is distinct from old.client_id then
  raise exception '개인 To-do의 소유자와 식별자는 변경할 수 없습니다.' using errcode='42501';
 end if;
 new.created_at:=old.created_at;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function app.personal_schedule_todo_stamp() from public,anon,authenticated;
create trigger personal_schedule_todo_stamp before update on public.personal_schedule_todos
 for each row execute function app.personal_schedule_todo_stamp();

-- 구버전 함수/반환값/권한은 그대로 두고 새 화면 전용 조회를 추가한다.
create function app.meeting_availability_with_todos(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); base jsonb;
begin
 -- 기존 함수가 활성 직원, 회사, 호스트/생성자, 대상 직원, 회차 권한을 모두 검사한다.
 base:=app.meeting_availability(p_series,p_date,p_people,p_exclude_round);
 return base || (select coalesce(jsonb_agg(jsonb_build_object(
  'id','todo:'||t.id,'personId',t.owner_id,'kind','personal','status','approved',
  'start',to_char(t.start_time,'HH24:MI'),'end',to_char(t.end_time,'HH24:MI')
 )),'[]'::jsonb) from public.personal_schedule_todos t
 where t.company_id=company and t.owner_id=any(p_people) and t.date=p_date
 and t.important and not t.done and t.deleted_at is null
 and t.start_time is not null and t.end_time is not null);
end $$;
create function public.list_meeting_availability_with_todos(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select app.meeting_availability_with_todos(p_series,p_date,p_people,p_exclude_round);
$$;
revoke all on function app.meeting_availability_with_todos(uuid,date,uuid[],uuid),public.list_meeting_availability_with_todos(uuid,date,uuid[],uuid) from public,anon;
grant execute on function app.meeting_availability_with_todos(uuid,date,uuid[],uuid),public.list_meeting_availability_with_todos(uuid,date,uuid[],uuid) to authenticated;
notify pgrst,'reload schema';