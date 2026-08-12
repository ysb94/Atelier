-- 같은 날 저녁에 이어지는 다음 행사도 구분할 수 있도록
-- 행사 기간을 날짜에서 분 단위 시각(timestamp, 시간대 없음)으로 바꾼다.
-- 사방넷 주문일시는 시간대 없는 한국 벽시계 문자열이므로 timestamptz를 쓰지 않는다.

alter table public.invoice_prefix_requests
  drop constraint if exists invoice_prefix_requests_period_check;

drop index if exists public.invoice_prefix_requests_period_idx;

alter table public.invoice_prefix_requests
  alter column starts_on type timestamp using starts_on::timestamp,
  alter column ends_on type timestamp
    using (ends_on::timestamp + interval '23 hours 59 minutes');

alter table public.invoice_prefix_requests rename column starts_on to starts_at;
alter table public.invoice_prefix_requests rename column ends_on to ends_at;

alter table public.invoice_prefix_requests
  add constraint invoice_prefix_requests_period_check
  check (ends_at >= starts_at);

create index invoice_prefix_requests_period_idx
  on public.invoice_prefix_requests (brand_id, starts_at, ends_at)
  where is_active;

comment on column public.invoice_prefix_requests.starts_at is
  '행사 시작 시각(분 단위 한국 벽시계). 사방넷 주문일시와 같은 기준으로 비교한다.';
comment on column public.invoice_prefix_requests.ends_at is
  '행사 종료 시각(분 단위 한국 벽시계). 양끝 포함으로 주문일시와 비교한다.';
