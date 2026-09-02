-- 대량출고 양식의 비개인정보 추가 열(발주번호·물류센터·상품번호 등)을 행에 남긴다.
-- 수령인·전화·주소는 기존처럼 저장하지 않는다.

alter table public.bulk_outbound_job_lines
  add column if not exists extra_values jsonb not null default '{}'::jsonb;

alter table public.bulk_outbound_job_lines
  drop constraint if exists bulk_outbound_job_lines_extra_values_object;

alter table public.bulk_outbound_job_lines
  add constraint bulk_outbound_job_lines_extra_values_object
  check (jsonb_typeof(extra_values) = 'object');

comment on column public.bulk_outbound_job_lines.extra_values is
  '양식 추가 열의 비개인정보 값. 키는 필드 id와 헤더 이름이다.';

comment on table public.bulk_outbound_job_lines is
  '작업 엑셀의 비개인정보 행. 바코드·수량·상품명과 양식 추가 열을 둔다.';

create or replace function public.save_bulk_outbound_job(
  p_brand_id uuid,
  p_id uuid,
  p_usage_target_id uuid,
  p_title text,
  p_status text,
  p_barcode_source text,
  p_started_on date,
  p_due_on date,
  p_assignee text,
  p_note text,
  p_planned_qty integer,
  p_lines jsonb,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_id uuid;
  item jsonb;
  v_file_id uuid;
  i integer := 0;
  v_extra jsonb;
  v_clean jsonb;
  v_key text;
  v_val text;
  v_extra_count integer;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception '작업 제목을 입력하세요.';
  end if;
  if p_status not in ('draft', 'converting', 'backup', 'docs', 'done') then
    raise exception '작업 상태가 올바르지 않습니다.';
  end if;
  if p_barcode_source not in ('own', 'partner') then
    raise exception '바코드 출처가 올바르지 않습니다.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '작업 행 형식이 올바르지 않습니다.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception '파일 메타 형식이 올바르지 않습니다.';
  end if;

  if p_id is null then
    insert into public.bulk_outbound_jobs (
      brand_id, usage_target_id, title, status, barcode_source,
      started_on, due_on, assignee, note, planned_qty
    ) values (
      p_brand_id,
      p_usage_target_id,
      btrim(p_title),
      p_status,
      p_barcode_source,
      coalesce(p_started_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_due_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_assignee, ''),
      coalesce(p_note, ''),
      greatest(0, coalesce(p_planned_qty, 0))
    )
    returning id into v_id;
  else
    update public.bulk_outbound_jobs
    set usage_target_id = p_usage_target_id,
        title = btrim(p_title),
        status = p_status,
        barcode_source = p_barcode_source,
        started_on = coalesce(p_started_on, started_on),
        due_on = coalesce(p_due_on, due_on),
        assignee = coalesce(p_assignee, assignee),
        note = coalesce(p_note, note),
        planned_qty = greatest(0, coalesce(p_planned_qty, planned_qty)),
        updated_at = now()
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '작업을 찾을 수 없습니다.';
    end if;
  end if;

  delete from public.bulk_outbound_job_lines
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_lines)
  loop
    i := i + 1;
    v_extra := coalesce(item->'extraValues', '{}'::jsonb);
    if jsonb_typeof(v_extra) <> 'object' then
      v_extra := '{}'::jsonb;
    end if;

    v_clean := '{}'::jsonb;
    v_extra_count := 0;
    for v_key, v_val in select key, value from jsonb_each_text(v_extra)
    loop
      if v_extra_count >= 40 then
        exit;
      end if;
      if v_key ~* '(받는분|수령인|성명|전화번호|연락처|핸드폰|휴대폰|주소|배송메시지)' then
        continue;
      end if;
      if length(btrim(v_key)) not between 1 and 120 then
        continue;
      end if;
      v_clean := v_clean || jsonb_build_object(btrim(v_key), left(coalesce(v_val, ''), 500));
      v_extra_count := v_extra_count + 1;
    end loop;

    insert into public.bulk_outbound_job_lines (
      brand_id, job_id, barcode, order_qty, product_name, source_row_no, extra_values
    ) values (
      p_brand_id,
      v_id,
      coalesce(item->>'barcode', ''),
      greatest(0, coalesce((item->>'orderQty')::int, 0)),
      coalesce(item->>'productName', ''),
      coalesce((item->>'sourceRowNo')::int, i),
      v_clean
    );
  end loop;

  delete from public.bulk_outbound_job_files
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_files)
  loop
    v_file_id := null;
    begin
      v_file_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        v_file_id := null;
    end;
    insert into public.bulk_outbound_job_files (
      id, brand_id, job_id, file_name, file_size, kept_on
    ) values (
      coalesce(v_file_id, gen_random_uuid()),
      p_brand_id,
      v_id,
      btrim(coalesce(item->>'name', item->>'fileName', 'file')),
      greatest(0, coalesce((item->>'fileSize')::bigint, 0)),
      coalesce((item->>'keptOn')::date, (timezone('Asia/Seoul', now()))::date)
    );
  end loop;

  return v_id;
end;
$function$;

revoke all on function public.save_bulk_outbound_job(
  uuid, uuid, uuid, text, text, text, date, date, text, text, integer, jsonb, jsonb
) from public, anon;
grant execute on function public.save_bulk_outbound_job(
  uuid, uuid, uuid, text, text, text, date, date, text, text, integer, jsonb, jsonb
) to authenticated;
