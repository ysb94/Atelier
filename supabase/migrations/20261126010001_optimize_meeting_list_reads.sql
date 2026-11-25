-- Build the existing listing once. Visibility and full round access still use
-- the same predicates and permission helpers as the original listing.
create or replace function app.meeting_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  with viewer as materialized (
    select auth.uid() as id, app.meeting_company_id() as company_id
  ), visible_series as materialized (
    select s.*, app.meeting_person(s.host_id) as host, viewer.id as viewer_id
    from public.meeting_series s cross join viewer
    where s.company_id = viewer.company_id and s.deleted_at is null
      and (s.phase = 'published' or app.meeting_can_read(s.id))
  ), visible_rounds as materialized (
    select r.*, s.viewer_id, (s.host->>'id')::uuid = s.viewer_id as viewer_is_host,
      app.meeting_round_can_read(r.id) as full_access
    from public.meeting_rounds r join visible_series s on s.id = r.series_id
    where r.deleted_at is null and (r.confirmed_at is not null or s.host_id = s.viewer_id
      or (s.phase = 'preparing' and s.created_by = s.viewer_id))
  ), series_rounds as (
    select r.series_id, jsonb_agg(jsonb_build_object(
      'id', r.id, 'round', r.round_no, 'roomId', coalesce(r.room_id, ''),
      'startsAt', coalesce(to_char(r.starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'), ''),
      'durationMinutes', r.duration_minutes, 'confirmed', r.confirmed_at is not null,
      'scheduleVersion', r.schedule_version, 'manualConfirmation', app.meeting_round_decision(r.id),
      'membership', roster.membership, 'responses', roster.responses,
      'sharedResults', results.versions,
      'detailAccess', case
        when r.full_access then 'full'
        when roster.result_recipient or jsonb_array_length(results.versions) > 0 or exists (
          select 1 from public.meeting_round_notices n
          where n.round_id = r.id and n.recipient_id = r.viewer_id and n.kind = 'removed'
        ) then 'result'
        else 'none' end,
      'content', case when r.full_access then r.content else '' end,
      'result', case
        when not r.viewer_is_host and exists (
          select 1 from app.meeting_round_rosters m where m.round_id = r.id
        ) then coalesce(results.versions->-1->>'body', '')
        when not r.full_access then ''
        when r.viewer_is_host then coalesce((select d.body from app.meeting_result_drafts d where d.round_id = r.id), r.result)
        else r.result end,
      'prepMaterials', case when r.full_access then coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.file_name,
          'size', f.size_bytes, 'type', f.content_type, 'url', '',
          'storagePath', f.storage_path, 'uploadedBy', app.meeting_person(f.uploaded_by)
        ) order by f.created_at, f.id)
        from public.meeting_files f where f.round_id = r.id and f.ready and f.deleted_at is null
      ), '[]'::jsonb) else '[]'::jsonb end
    ) order by r.round_no) as rounds
    from visible_rounds r
    cross join lateral (
      -- Keep the helper's legacy roster fallback. Reuse only within this round
      -- and statement, including for the caller's own result-only role.
      with people as materialized (select * from app.meeting_round_people_rows(r.id))
      select coalesce((select jsonb_agg(jsonb_build_object('person', app.meeting_person(p.profile_id),
        'role', p.role) order by p.profile_id) from people p), '[]'::jsonb) as membership,
        exists(select 1 from people p where p.profile_id = r.viewer_id and p.role = 'result') as result_recipient,
        case when r.full_access then coalesce((
          select jsonb_agg(jsonb_build_object('profileId', p.profile_id, 'status', coalesce(i.status, 'pending')))
          from people p left join public.meeting_invitations i on i.round_id = r.id
            and i.profile_id = p.profile_id and i.schedule_version = r.schedule_version
          where p.role = 'attendee'
        ), '[]'::jsonb) else '[]'::jsonb end as responses
    ) roster
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'body', v.body,
        'sharedAt', v.shared_at) order by v.version), '[]'::jsonb) as versions
      from app.meeting_result_versions v
      where v.round_id = r.id and (r.viewer_is_host or exists (
        select 1 from public.meeting_round_notices n where n.result_id = v.id and n.recipient_id = r.viewer_id
      ))
    ) results
    group by r.series_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'title', s.title, 'kind', s.kind, 'host', s.host, 'status', s.status,
    'durationMinutes', s.duration_minutes, 'revision', s.revision, 'phase', s.phase,
    'createdBy', s.created_by, 'manualConfirmationReady', true, 'roundMembershipReady', true,
    'members', coalesce((select jsonb_agg(app.meeting_person(m.profile_id) order by m.profile_id)
      from public.meeting_members m where m.series_id = s.id), '[]'::jsonb),
    'rounds', coalesce(sr.rounds, '[]'::jsonb)
  ) order by s.updated_at desc, s.id), '[]'::jsonb)
  from visible_series s left join series_rounds sr on sr.series_id = s.id;
$$;
