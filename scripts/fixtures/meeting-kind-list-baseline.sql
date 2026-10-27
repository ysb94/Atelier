-- 적용 직전 공유 DB의 조회 함수. 격리 PGlite 검증 전용이며 앱·서버에 배포하지 않는다.
CREATE OR REPLACE FUNCTION app.meeting_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'host', app.meeting_person(s.host_id),
    'status', s.status,
    'durationMinutes', s.duration_minutes,
    'revision', s.revision,
    'phase', s.phase,
    'createdBy', s.created_by,
    'members', coalesce((select jsonb_agg(app.meeting_person(m.profile_id) order by m.profile_id)
      from public.meeting_members m where m.series_id = s.id), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'round', r.round_no,
      'startsAt', coalesce(to_char(r.starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'), ''),
      'roomId', coalesce(r.room_id, ''),
      'durationMinutes', r.duration_minutes,
      'confirmed', r.confirmed_at is not null,
      'scheduleVersion', r.schedule_version,
      'content', case when s.host_id = auth.uid() or exists(select 1 from public.meeting_members detail_member where detail_member.series_id = s.id and detail_member.profile_id = auth.uid()) or (s.phase = 'preparing' and s.created_by = auth.uid()) then r.content else '' end,
      'result', case when s.host_id = auth.uid() or exists(select 1 from public.meeting_members detail_member where detail_member.series_id = s.id and detail_member.profile_id = auth.uid()) or (s.phase = 'preparing' and s.created_by = auth.uid()) then r.result else '' end,
      'prepMaterials', case when s.host_id = auth.uid() or exists(select 1 from public.meeting_members detail_member where detail_member.series_id = s.id and detail_member.profile_id = auth.uid()) or (s.phase = 'preparing' and s.created_by = auth.uid()) then coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.file_name, 'size', f.size_bytes, 'type', f.content_type, 'url', '',
        'storagePath', f.storage_path, 'uploadedBy', app.meeting_person(f.uploaded_by)) order by f.created_at, f.id)
        from public.meeting_files f where f.round_id = r.id and f.ready and f.deleted_at is null), '[]'::jsonb) else '[]'::jsonb end,
      'responses', coalesce((select jsonb_agg(jsonb_build_object('profileId', m.profile_id, 'status', coalesce(i.status, 'pending'), 'respondedAt', i.responded_at) order by m.profile_id)
        from public.meeting_members m left join public.meeting_invitations i on i.round_id = r.id and i.profile_id = m.profile_id and i.schedule_version = r.schedule_version
        where m.series_id = s.id), '[]'::jsonb)
    ) order by r.round_no)
    from public.meeting_rounds r
    where r.series_id = s.id and r.deleted_at is null
      and (r.confirmed_at is not null or s.host_id = auth.uid() or (s.phase = 'preparing' and s.created_by = auth.uid()))
    ), '[]'::jsonb)
  ) order by s.updated_at desc, s.id), '[]'::jsonb)
  from public.meeting_series s
  where s.company_id = app.meeting_company_id()
    and s.deleted_at is null
    and (app.meeting_can_read(s.id) or s.phase = 'published');
$function$
;
