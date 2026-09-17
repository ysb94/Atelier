alter table public.cargo_inbound_lines
  add column if not exists request_note text not null default '';

comment on column public.cargo_inbound_lines.request_note is
  '화물 입고 요청 사항. 엑셀 비고(note)와 분리한다.';
