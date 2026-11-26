-- The global inbox and 30-minute reminder need the caller's notifications and
-- schedule, while the agenda screen retains the existing full listing.
create function app.meeting_notice_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  with viewer as materialized (
    select auth.uid() as id, app.meeting_company_id() as company_id
  ), invitations as materialized (
    select app.meeting_notifications() as items
  ), notice_refs as materialized (
    select substring(item->>'href' from '[?&]meeting=([0-9a-f-]{36})')::uuid as series_id,
      substring(item->>'href' from '[?&]round=([0-9a-f-]{36})')::uuid as round_id,
      item->>'kind' = 'meeting_invitation' and coalesce(item#>>'{meeting,role}', 'member') <> 'host' as member_invitation
    from invitations, lateral jsonb_array_elements(items) item
  ), series as materialized (
    select s.id, s.title, s.status, s.phase, s.host_id, s.created_by, s.duration_minutes, v.id as viewer_id
    from public.meeting_series s join viewer v on s.company_id = v.company_id
    where s.deleted_at is null and (s.phase = 'published' or app.meeting_can_read(s.id))
  ), response_context as (
    select r.series_id, jsonb_agg(jsonb_build_object(
      'id', r.id, 'scheduleVersion', r.schedule_version,
      'response', case when i.status is not null and app.meeting_round_can_read(r.id)
        and exists (select 1 from app.meeting_round_people_rows(r.id) p
          where p.profile_id = s.viewer_id and p.role = 'attendee') then i.status else 'pending' end,
      'finalized', app.meeting_round_decision(r.id) is not null
    ) order by r.round_no) as rounds
    from public.meeting_rounds r join series s on s.id = r.series_id
    left join public.meeting_invitations i on i.round_id = r.id and i.profile_id = s.viewer_id and i.schedule_version = r.schedule_version
    where exists (select 1 from notice_refs n where n.member_invitation and n.round_id = r.id and n.series_id = s.id)
      and r.deleted_at is null and (r.confirmed_at is not null or s.host_id = s.viewer_id
      or (s.phase = 'preparing' and s.created_by = s.viewer_id))
    group by r.series_id
  ), starts as (
    select s.id as series_id, s.title, r.id, r.round_no, r.starts_at, r.room_id, r.schedule_version,
      coalesce(r.duration_minutes, s.duration_minutes) as duration,
      case when s.host_id = s.viewer_id then '호스트' else '멤버' end as role
    from series s join public.meeting_rounds r on r.series_id = s.id
    where s.phase = 'published' and s.status = 'in_progress' and r.confirmed_at is not null
      and r.deleted_at is null and r.starts_at >= date_trunc('minute', now())
      and (s.host_id = s.viewer_id or exists (select 1 from app.meeting_round_people_rows(r.id) p
        where p.profile_id = s.viewer_id and p.role = 'attendee'))
      and not coalesce((app.meeting_round_decision(r.id)->'excludedIds') ? s.viewer_id::text, false)
  )
  select jsonb_build_object('invitations', (select items from invitations),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status,
      'rounds', coalesce(c.rounds, '[]'::jsonb)) order by s.id)
      from series s left join response_context c on c.series_id = s.id
      where exists (select 1 from notice_refs n where n.series_id = s.id)), '[]'::jsonb),
    'starts', coalesce((select jsonb_agg(jsonb_build_object('seriesId', series_id, 'roundId', id,
      'title', title, 'round', round_no, 'role', role, 'startsAt', to_char(starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'),
      'roomId', coalesce(room_id, ''), 'durationMinutes', duration, 'scheduleVersion', schedule_version)
      order by starts_at, id) from starts), '[]'::jsonb));
$$;
create function public.list_my_meeting_notice_context() returns jsonb
language sql stable security invoker set search_path = '' as $$ select app.meeting_notice_context() $$;
revoke all on function app.meeting_notice_context(), public.list_my_meeting_notice_context() from public, anon;
grant execute on function app.meeting_notice_context(), public.list_my_meeting_notice_context() to authenticated;
notify pgrst, 'reload schema';
