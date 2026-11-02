-- 처음 적용된 삭제 함수의 안내 문구를 마이그레이션 파일과 같게 맞춘다.
create or replace function app.remove_my_late_statement_file(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  file public.late_arrival_statement_files%rowtype;
  statement public.late_arrival_statements%rowtype;
begin
  select * into file from public.late_arrival_statement_files where id = p_id and uploaded_by = actor;
  if file.id is null then
    raise exception '첨부파일을 찾지 못했습니다.' using errcode = '42501';
  end if;
  select * into statement from public.late_arrival_statements where id = file.statement_id and employee_id = actor;
  if statement.id is null
    or statement.work_date <> (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 사유서의 첨부만 뺄 수 있습니다.' using errcode = '42501';
  end if;
  delete from public.late_arrival_statement_files where id = file.id;
  return file.storage_path;
end;
$$;
