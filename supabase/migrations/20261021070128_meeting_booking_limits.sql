-- 시간 덧셈의 자정 넘김도 테이블에서 차단한다. 기존 회의 이력의 메모 수정은 허용한다.
alter table public.meeting_rounds add constraint meeting_rounds_booking_hours check (
  starts_at is null or (
    extract(isodow from starts_at at time zone 'Asia/Seoul') between 1 and 5
    and (starts_at at time zone 'Asia/Seoul')::time >= time '09:00'
    and (starts_at at time zone 'Asia/Seoul')+make_interval(mins=>duration_minutes)
      <= (starts_at at time zone 'Asia/Seoul')::date+time '19:00'
    and extract(minute from starts_at at time zone 'Asia/Seoul')::integer % 30=0
    and extract(second from starts_at)=0
  )
);
