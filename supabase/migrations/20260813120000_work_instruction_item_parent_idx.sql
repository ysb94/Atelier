-- FK (brand_id, instruction_id) 삭제·조인용 커버 인덱스.
create index if not exists invoice_work_instruction_items_instruction_idx
  on public.invoice_work_instruction_items (brand_id, instruction_id);
