-- 종료일이 출고 예정일과 다르면(조기·지연 종료) 사유를 남긴다.

alter table public.invoice_preorder_holds
  add column if not exists ended_reason text not null default '';

comment on column public.invoice_preorder_holds.ended_reason is
  '종료일이 출고 예정일과 다를 때(조기·지연 종료) 사유. 같으면 빈 문자열.';

alter table public.invoice_preorder_holds
  drop constraint if exists invoice_preorder_holds_ended_reason_check;

alter table public.invoice_preorder_holds
  add constraint invoice_preorder_holds_ended_reason_check
  check (
    status <> 'ended'
    or ended_on = ship_on
    or length(btrim(ended_reason)) > 0
  );

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
  new.ended_reason := coalesce(btrim(new.ended_reason), '');
  if new.status in ('cleared', 'ended') and new.cleared_at is null then
    new.cleared_at := now();
  end if;
  if new.status = 'ended' and new.ended_on is null then
    new.ended_on := (timezone('Asia/Seoul', now()))::date;
  end if;
  if new.status = 'ended' and new.ended_on = new.ship_on then
    new.ended_reason := '';
  end if;
  if new.status = 'ended'
     and new.ended_on is distinct from new.ship_on
     and new.ended_reason = '' then
    raise exception '종료일이 출고 예정일과 다르면 사유를 입력하세요.';
  end if;
  if new.status = 'active' then
    new.cleared_at := null;
    new.ended_on := null;
    new.ended_reason := '';
  end if;
  if new.status = 'cleared' then
    new.ended_on := null;
    new.ended_reason := '';
  end if;
  return new;
end;
$$;
