-- 부서 팀장·이사는 자기 부서 공지를 등록·수정·삭제할 수 있다.
drop policy if exists company_notice_read on public.company_notices;

create policy company_notice_read on public.company_notices for select to authenticated
using (
  company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and (
    (select app.can_edit_org_assignment())
    or (
      slot = 'department'
      and department_id = (
        select p.department_id
        from public.profiles p
        where p.id = (select auth.uid())
          and p.status = 'active'
          and p.position in ('팀장', '이사')
      )
    )
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
  actor_department uuid;
  actor_position text;
  notice_title text := btrim(p_title);
  notice_body text := btrim(p_body);
  saved uuid;
  audience uuid := p_department_id;
begin
  if actor is null then
    raise exception '로그인이 필요합니다.';
  end if;
  select p.company_id, p.department_id, p.position
    into company, actor_department, actor_position
  from public.profiles p
  where p.id = actor and p.status = 'active';
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
  if not app.can_edit_org_assignment() then
    if p_slot is distinct from 'department'
      or actor_position is distinct from '팀장' and actor_position is distinct from '이사'
      or actor_department is null
      or audience is distinct from actor_department then
      raise exception '소속 부서의 팀장만 부서 공지를 등록할 수 있습니다.';
    end if;
    if p_id is not null and not exists (
      select 1 from public.company_notices n
      where n.id = p_id
        and n.company_id = company
        and n.slot = 'department'
        and n.department_id = actor_department
    ) then
      raise exception '수정할 부서 공지를 찾지 못했습니다.';
    end if;
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

create or replace function app.delete_company_notice(p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  company uuid;
  actor_department uuid;
  actor_position text;
  removed uuid;
begin
  if actor is null then
    raise exception '로그인이 필요합니다.';
  end if;
  select p.company_id, p.department_id, p.position
    into company, actor_department, actor_position
  from public.profiles p
  where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if not app.can_edit_org_assignment() then
    if actor_position is distinct from '팀장' and actor_position is distinct from '이사'
      or actor_department is null
      or not exists (
        select 1 from public.company_notices n
        where n.id = p_id
          and n.company_id = company
          and n.slot = 'department'
          and n.department_id = actor_department
      ) then
      raise exception '소속 부서의 팀장만 부서 공지를 삭제할 수 있습니다.';
    end if;
  end if;
  delete from public.company_notices where id = p_id and company_id = company returning id into removed;
  if removed is null then raise exception '삭제할 공지를 찾지 못했습니다. 목록을 새로고침해 주세요.'; end if;
end;
$$;

create or replace function public.save_company_notice(
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
security definer
set search_path = ''
as $$
  select app.save_company_notice(p_id, p_slot, p_department_id, p_title, p_body, p_starts, p_ends, p_published);
$$;

create or replace function public.delete_company_notice(p_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  select app.delete_company_notice(p_id);
$$;

revoke all on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) from public, anon;
revoke all on function public.delete_company_notice(uuid) from public, anon;
grant execute on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) to authenticated;
grant execute on function public.delete_company_notice(uuid) to authenticated;
