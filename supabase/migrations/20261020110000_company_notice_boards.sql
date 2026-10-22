-- My home 회사 공지·부서 공지 게시 위치를 추가한다.
alter table public.company_notices drop constraint company_notices_slot_check;

alter table public.company_notices
  add constraint company_notices_slot_check
  check (slot in ('my-attendance', 'company', 'department'));

create or replace function app.save_company_notice(
  p_id uuid,
  p_slot text,
  p_department_id uuid,
  p_title text,
  p_body text,
  p_starts date,
  p_ends date,
  p_published boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  company uuid;
  notice_title text := btrim(p_title);
  notice_body text := btrim(p_body);
  saved uuid;
  audience uuid := p_department_id;
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원팀만 공지를 저장할 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_slot is distinct from 'my-attendance'
    and p_slot is distinct from 'company'
    and p_slot is distinct from 'department' then
    raise exception '게시 위치를 확인해 주세요.';
  end if;
  if p_slot = 'company' then
    audience := null;
  elsif p_slot = 'department' and audience is null then
    raise exception '부서 공지는 대상 부서를 선택해 주세요.';
  end if;
  if notice_title is null or char_length(notice_title) < 1 or char_length(notice_title) > 80 then
    raise exception '제목은 1자에서 80자까지 입력해 주세요.';
  end if;
  if notice_body is null or char_length(notice_body) < 1 or char_length(notice_body) > 4000 then
    raise exception '내용은 1자에서 4000자까지 입력해 주세요.';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception '종료일은 시작일보다 빠를 수 없습니다.';
  end if;
  if audience is not null and not exists (
    select 1 from public.departments d where d.id = audience and d.company_id = company and d.is_active
  ) then
    raise exception '같은 회사의 사용 중인 부서를 선택해 주세요.';
  end if;
  if p_id is null then
    insert into public.company_notices (
      company_id, slot, department_id, title, body, starts_on, ends_on, published, updated_by
    ) values (
      company, p_slot, audience, notice_title, notice_body, p_starts, p_ends, coalesce(p_published, true), actor
    ) returning id into saved;
  else
    update public.company_notices
    set slot = p_slot,
        department_id = audience,
        title = notice_title,
        body = notice_body,
        starts_on = p_starts,
        ends_on = p_ends,
        published = coalesce(p_published, true),
        updated_by = actor,
        updated_at = pg_catalog.now()
    where id = p_id and company_id = company
    returning id into saved;
    if saved is null then raise exception '수정할 공지를 찾지 못했습니다. 목록을 새로고침해 주세요.'; end if;
  end if;
  return saved;
end;
$$;
