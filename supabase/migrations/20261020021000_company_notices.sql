-- Company-wide screen notices. Audience is the company, with an optional department.
create table public.company_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  slot text not null check (slot in ('my-attendance')),
  department_id uuid references public.departments(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 80),
  body text not null check (length(btrim(body)) between 1 and 4000),
  starts_on date,
  ends_on date,
  published boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index company_notices_slot on public.company_notices(company_id, slot, updated_at desc);
create index company_notices_department on public.company_notices(department_id);
alter table public.company_notices enable row level security;
revoke all on public.company_notices from anon, authenticated;
grant select on public.company_notices to authenticated;

create policy company_notice_read on public.company_notices for select to authenticated
using (
  company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and (
    (select app.can_edit_org_assignment())
    or (
      published
      and (starts_on is null or starts_on <= (timezone('Asia/Seoul', now()))::date)
      and (ends_on is null or ends_on >= (timezone('Asia/Seoul', now()))::date)
      and (
        department_id is null
        or department_id = (select p.department_id from public.profiles p where p.id = (select auth.uid()))
      )
    )
  )
);

create function app.save_company_notice(
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
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원팀만 공지를 저장할 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_slot is distinct from 'my-attendance' then raise exception '게시 위치를 확인해 주세요.'; end if;
  if notice_title is null or char_length(notice_title) < 1 or char_length(notice_title) > 80 then
    raise exception '제목은 1자에서 80자까지 입력해 주세요.';
  end if;
  if notice_body is null or char_length(notice_body) < 1 or char_length(notice_body) > 4000 then
    raise exception '내용은 1자에서 4000자까지 입력해 주세요.';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception '종료일은 시작일보다 빠를 수 없습니다.';
  end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id and d.company_id = company and d.is_active
  ) then
    raise exception '같은 회사의 사용 중인 부서를 선택해 주세요.';
  end if;
  if p_id is null then
    insert into public.company_notices (
      company_id, slot, department_id, title, body, starts_on, ends_on, published, updated_by
    ) values (
      company, p_slot, p_department_id, notice_title, notice_body, p_starts, p_ends, coalesce(p_published, true), actor
    ) returning id into saved;
  else
    update public.company_notices
    set slot = p_slot,
        department_id = p_department_id,
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
revoke all on function app.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) from public, anon, authenticated;

create function public.save_company_notice(
  p_id uuid,
  p_slot text,
  p_department_id uuid,
  p_title text,
  p_body text,
  p_starts date,
  p_ends date,
  p_published boolean
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.save_company_notice(p_id, p_slot, p_department_id, p_title, p_body, p_starts, p_ends, p_published);
$$;
revoke all on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) to authenticated;

create function app.delete_company_notice(p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid(); company uuid; removed uuid;
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원팀만 공지를 삭제할 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  delete from public.company_notices where id = p_id and company_id = company returning id into removed;
  if removed is null then raise exception '삭제할 공지를 찾지 못했습니다. 목록을 새로고침해 주세요.'; end if;
end;
$$;
revoke all on function app.delete_company_notice(uuid) from public, anon, authenticated;

create function public.delete_company_notice(p_id uuid) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app.delete_company_notice(p_id);
end;
$$;
revoke all on function public.delete_company_notice(uuid) from public, anon, authenticated;
grant execute on function public.delete_company_notice(uuid) to authenticated;

insert into public.company_notices (company_id, slot, title, body, published)
select c.id, 'my-attendance', '공지] 휴가 사용 제도 안내', $notice$직원 여러분의 근무 편의성과 휴가 활용의 유연성을 높이기 위해
기존 휴가 제도에 반반차(¼차) 사용 방식을 추가 운영합니다.

■ 시행일
2026년 2월 24일 ~
■ 휴가 사용 단위
연차 : 1일
반차 : 0.5일
반반차 : 0.25일 (추가 도입)

■ 반반차 사용 기준
1회 사용 시 근무시간의 ¼ (약 2시간) 사용
당일 업무 인수인계 및 팀 일정에 지장이 없도록 사전 협의 필수
■ 사용 예시
병원 방문, 은행 업무 등 단시간 외출
등·하원, 가족 일정 등 개인 용무 처리
■ 신청 방법
기존 휴가 신청 방식과 동일
최소 2일 전 신청 원칙 (긴급 상황 시 팀장 협의)

직원 여러분이 보다 효율적으로 시간을 활용할 수 있도록 도입된 제도이니,
업무 공백이 발생하지 않도록 서로 배려하며 사용해 주시기 바랍니다.$notice$, true
from public.companies c
where not exists (
  select 1 from public.company_notices n
  where n.company_id = c.id and n.slot = 'my-attendance' and n.department_id is null
);
