-- 작업 지시에도 선택 적용 기간을 둔다. 둘 다 null이면 중지 전까지 항상 적용.
-- 기간이 있으면 사은품과 같이 timestamp(시간대 없음)로 주문일시와 비교한다.
-- 같은 품목명을 기간이 다른 지시에 나눠 등록할 수 있게 브랜드 전역 unique를 푼다.

alter table public.invoice_work_instructions
  add column if not exists starts_at timestamp,
  add column if not exists ends_at timestamp;

alter table public.invoice_work_instructions
  drop constraint if exists invoice_work_instructions_period_check;

alter table public.invoice_work_instructions
  add constraint invoice_work_instructions_period_check
  check (
    (starts_at is null and ends_at is null)
    or (
      starts_at is not null
      and ends_at is not null
      and ends_at >= starts_at
    )
  );

comment on column public.invoice_work_instructions.starts_at is
  '적용 시작. starts_at/ends_at이 둘 다 null이면 중지 전까지 항상 적용. timestamp(시간대 없음).';
comment on column public.invoice_work_instructions.ends_at is
  '적용 종료. starts_at과 함께 쓰며 양끝 포함.';

comment on table public.invoice_work_instructions is
  '포장·특이사항 작업 지시. 원본 품목명 앞에 표시 문구를 붙인다. 적용 기간은 선택.';

drop index if exists public.invoice_work_instruction_items_brand_product_uidx;

create unique index if not exists invoice_work_instruction_items_instruction_product_uidx
  on public.invoice_work_instruction_items (instruction_id, normalized_product_name);

comment on column public.invoice_work_instruction_items.product_name is
  '사방넷 품목명. 기간이 겹치지 않으면 같은 품목명을 여러 지시에 등록할 수 있다.';

create index if not exists invoice_work_instructions_brand_period_idx
  on public.invoice_work_instructions (brand_id, starts_at, ends_at)
  where is_active;
