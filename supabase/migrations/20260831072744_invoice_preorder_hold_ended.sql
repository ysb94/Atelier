-- 예발은 출고 예정일이 지나도 자동으로 끝나지 않는다.
-- 작업자가 「종료」할 때까지 active로 두고, 예정일보다 일찍 끝낼 수도 있다.
-- 「제거」는 cleared(등록 취소), 「종료」는 ended(예발 구간 종료).

alter table public.invoice_preorder_holds
  add column if not exists ended_on date;

comment on column public.invoice_preorder_holds.ship_on is
  '출고 예정일(계획). 날짜가 지나도 자동 종료하지 않으며, 종료 전까지 active다.';
comment on column public.invoice_preorder_holds.status is
  'active=진행 중, ended=예발 종료(이력), cleared=목록에서 제거(이력).';
comment on column public.invoice_preorder_holds.ended_on is
  '예발이 실제로 끝난 업무일. ended일 때 필수. 예정일보다 이를 수 있다.';
comment on column public.invoice_preorder_holds.cleared_at is
  'active를 벗어난 시각. ended·cleared 모두 기록한다.';

alter table public.invoice_preorder_holds
  drop constraint if exists invoice_preorder_holds_status_check;

alter table public.invoice_preorder_holds
  add constraint invoice_preorder_holds_status_check
  check (status in ('active', 'ended', 'cleared'));

alter table public.invoice_preorder_holds
  drop constraint if exists invoice_preorder_holds_cleared_at_check;

alter table public.invoice_preorder_holds
  add constraint invoice_preorder_holds_closure_check
  check (
    (status = 'active' and cleared_at is null and ended_on is null)
    or (status = 'cleared' and cleared_at is not null and ended_on is null)
    or (status = 'ended' and cleared_at is not null and ended_on is not null)
  );

alter table public.invoice_preorder_holds
  drop constraint if exists invoice_preorder_holds_ended_on_check;

alter table public.invoice_preorder_holds
  add constraint invoice_preorder_holds_ended_on_check
  check (ended_on is null or ended_on >= started_on);

create or replace function public.invoice_preorder_holds_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reason := btrim(new.reason);
  if new.reason = '' then
    raise exception '예발 사유를 입력하세요.';
  end if;
  if new.status in ('cleared', 'ended') and new.cleared_at is null then
    new.cleared_at := now();
  end if;
  if new.status = 'ended' and new.ended_on is null then
    new.ended_on := (timezone('Asia/Seoul', now()))::date;
  end if;
  if new.status = 'active' then
    new.cleared_at := null;
    new.ended_on := null;
  end if;
  if new.status = 'cleared' then
    new.ended_on := null;
  end if;
  return new;
end;
$$;
