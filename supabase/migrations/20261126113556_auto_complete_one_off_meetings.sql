-- 기존 완료 상태를 사용한다. 회의 내용·결과·자료·참석 응답은 수정하지 않는다.
begin;

create function app.complete_expired_one_off_meetings() returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  company uuid;
  cutoff timestamptz := now() - interval '24 hours';
  affected integer;
  total integer := 0;
begin
  for company in
    select distinct s.company_id from public.meeting_series s
    where s.kind = 'one_off' and s.status = 'in_progress'
      and s.phase = 'published' and s.deleted_at is null
    order by s.company_id
  loop
    -- 일정 변경과 동일한 회사 잠금. 수정 중인 회사는 다음 실행에 재검사한다.
    if not pg_try_advisory_xact_lock(hashtextextended(company::text, 7341)) then
      continue;
    end if;

    update public.meeting_series s
    set status = 'done', revision = s.revision + 1, updated_at = now()
    where s.company_id = company and s.kind = 'one_off'
      and s.status = 'in_progress' and s.phase = 'published' and s.deleted_at is null
      and exists (
        select 1 from public.meeting_rounds r
        where r.company_id = s.company_id and r.series_id = s.id
          and r.deleted_at is null and r.confirmed_at is not null and r.starts_at is not null
      )
      -- 일정 미정·미확정·아직 24시간이 안 지난 유효 회차가 있으면 보류한다.
      and not exists (
        select 1 from public.meeting_rounds r
        where r.company_id = s.company_id and r.series_id = s.id and r.deleted_at is null
          and (r.confirmed_at is null or r.starts_at is null
            or r.starts_at + make_interval(mins => r.duration_minutes) > cutoff)
      );
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;
  return total;
end;
$$;

-- DB 예약 작업 전용. 직원이나 익명 사용자가 직접 일괄 완료할 수 없다.
revoke all on function app.complete_expired_one_off_meetings() from public, anon, authenticated;

-- 화면을 열지 않아도 처리하며, 기존에 쌓인 대상도 첫 실행부터 포함한다.
select cron.schedule(
  'atelier-one-off-meeting-completion',
  '* * * * *',
  'select app.complete_expired_one_off_meetings();'
);

commit;
