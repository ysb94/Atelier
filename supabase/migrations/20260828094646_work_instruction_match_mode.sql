-- 작업 지시에 완전일치/시작어 매칭을 둔다.
-- 시작어는 등록한 글자 그대로 앞에 있을 때만 맞춘다.
-- 기존 지시는 exact로 남는다.

alter table public.invoice_work_instructions
  add column if not exists match_mode text not null default 'exact';

alter table public.invoice_work_instructions
  drop constraint if exists invoice_work_instructions_match_mode_check;
alter table public.invoice_work_instructions
  add constraint invoice_work_instructions_match_mode_check
  check (match_mode = any (array['exact', 'prefix']));

comment on column public.invoice_work_instructions.match_mode is
  'exact는 원본 품목명 완전일치, prefix는 등록 글자로 시작할 때만 표시 문구를 붙인다.';

comment on table public.invoice_work_instructions is
  '포장·특이사항 작업 지시. 완전일치 또는 시작어로 원본 품목명 앞에 표시 문구를 붙인다. 적용 기간은 선택이고 비면 항상 적용한다.';
