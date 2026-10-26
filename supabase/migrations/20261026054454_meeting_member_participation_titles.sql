-- 멤버 선택용 최소 조회. 본문/회차/자료/채팅 RLS와 기존 조회 함수는 바꾸지 않는다.
create function app.meeting_member_participation()
returns table(profile_id uuid, titles text[])
language sql stable security definer set search_path = '' as $$
  with ongoing as materialized (
    select s.id, s.company_id, s.host_id, s.title, s.created_at
    from public.meeting_series s
    where auth.uid() is not null
      and s.company_id = (select app.meeting_company_id())
      and s.status = 'in_progress' and s.phase = 'published' and s.deleted_at is null
      and exists (
        select 1 from public.meeting_rounds r
        where r.series_id = s.id and r.company_id = s.company_id
          and r.confirmed_at is not null and r.deleted_at is null
      )
  ), participants as (
    select s.id, s.company_id, s.host_id as profile_id, s.title, s.created_at from ongoing s
    union
    select s.id, s.company_id, m.profile_id, s.title, s.created_at
    from ongoing s join public.meeting_members m on m.series_id = s.id and m.company_id = s.company_id
  )
  select x.profile_id, array_agg(x.title order by x.created_at, x.id)
  from participants x join public.profiles p on p.id = x.profile_id and p.company_id = x.company_id and p.status = 'active'
  group by x.profile_id
  order by x.profile_id;
$$;
revoke all on function app.meeting_member_participation() from public, anon, authenticated;
grant execute on function app.meeting_member_participation() to authenticated;

create function public.list_meeting_member_participation()
returns table(profile_id uuid, titles text[])
language sql stable security invoker set search_path = '' as $$
  select * from app.meeting_member_participation();
$$;
revoke all on function public.list_meeting_member_participation() from public, anon, authenticated;
grant execute on function public.list_meeting_member_participation() to authenticated;

comment on function public.list_meeting_member_participation() is
  '같은 회사 재직자의 확정된 진행 회의 제목만 반환. 회의 본문·자료·채팅 접근은 부여하지 않음.';
