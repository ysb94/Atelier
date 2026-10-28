begin;
-- 출퇴근·휴가·사용자 원본은 수정하지 않는다. 현재 제외자 두 계정만 최초 명단에 이어받는다.
create table public.attendance_exemptions (
  company_id uuid not null references public.companies(id),
  profile_id uuid not null references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(company_id,profile_id)
);
alter table public.attendance_exemptions enable row level security;
revoke all on public.attendance_exemptions from anon,authenticated;
grant select,insert,delete on public.attendance_exemptions to authenticated;
create policy attendance_exemptions_read on public.attendance_exemptions for select to authenticated using (
  company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and (profile_id=(select auth.uid()) or (select app.can_edit_org_assignment()))
);
create policy attendance_exemptions_insert on public.attendance_exemptions for insert to authenticated with check (
  (select app.can_edit_org_assignment())
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and exists(select 1 from public.profiles target where target.id=profile_id and target.company_id=attendance_exemptions.company_id and target.status='active')
  and created_by=(select auth.uid())
);
create policy attendance_exemptions_delete on public.attendance_exemptions for delete to authenticated using (
  (select app.can_edit_org_assignment())
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
);
create function app.list_company_attendance_exempt() returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare company uuid;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null then raise exception '재직 중인 직원만 제외 설정을 확인할 수 있습니다.' using errcode='42501'; end if;
  return coalesce((select array_agg(e.profile_id order by e.profile_id) from public.attendance_exemptions e
    join public.profiles p on p.id=e.profile_id and p.company_id=e.company_id and p.status='active' where e.company_id=company),'{}'::uuid[]);
end $$;
create function app.is_my_attendance_exempt() returns boolean language plpgsql stable security definer set search_path='' as $$
declare company uuid;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null then raise exception '재직 중인 직원만 제외 설정을 확인할 수 있습니다.' using errcode='42501'; end if;
  return exists(select 1 from public.attendance_exemptions where company_id=company and profile_id=auth.uid());
end $$;
create function app.set_attendance_exemption(p_profile uuid,p_exempt boolean) returns void language plpgsql security definer set search_path='' as $$
declare company uuid;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not app.can_edit_org_assignment() then raise exception '직원 배치 관리 권한이 있는 담당자만 제외자를 변경할 수 있습니다.' using errcode='42501'; end if;
  if p_exempt is null or not exists(select 1 from public.profiles where id=p_profile and company_id=company and (not p_exempt or status='active')) then
    raise exception '같은 회사의 재직 직원을 선택하세요.' using errcode='42501'; end if;
  if p_exempt then
    insert into public.attendance_exemptions(company_id,profile_id,created_by) values(company,p_profile,auth.uid()) on conflict(company_id,profile_id) do nothing;
  else delete from public.attendance_exemptions where company_id=company and profile_id=p_profile;
  end if;
end $$;
revoke all on function app.list_company_attendance_exempt(),app.is_my_attendance_exempt(),app.set_attendance_exemption(uuid,boolean) from public,anon,authenticated;
create function public.list_company_attendance_exempt() returns uuid[] language sql stable set search_path='' as $$select app.list_company_attendance_exempt()$$;
create function public.is_my_attendance_exempt() returns boolean language sql stable set search_path='' as $$select app.is_my_attendance_exempt()$$;
create function public.set_attendance_exemption(p_profile uuid,p_exempt boolean) returns void language sql set search_path='' as $$select app.set_attendance_exemption(p_profile,p_exempt)$$;
revoke all on function public.list_company_attendance_exempt(),public.is_my_attendance_exempt(),public.set_attendance_exemption(uuid,boolean) from public,anon,authenticated;
grant execute on function public.list_company_attendance_exempt(),public.is_my_attendance_exempt(),public.set_attendance_exemption(uuid,boolean) to authenticated;
-- 공개 래퍼가 호출하는 app 함수도 본인·회사·관리 권한을 매번 검사한다.
grant execute on function app.list_company_attendance_exempt(),app.is_my_attendance_exempt(),app.set_attendance_exemption(uuid,boolean) to authenticated;
do $$begin
  if (select count(*) from public.profiles where company_id='e0000000-0000-4000-8000-000000000001' and status='active'
      and id in ('2dedf0e7-3237-417a-a22f-1fc2cd89272a','56074867-fdc2-4ce5-8e97-cea431decc36'))<>2 then
    raise exception '기존 제외자 두 계정을 확인하지 못했습니다. 최초 명단 적용을 중단합니다.';
  end if;
end $$;
insert into public.attendance_exemptions(company_id,profile_id)
select company_id,id from public.profiles where company_id='e0000000-0000-4000-8000-000000000001'
  and id in ('2dedf0e7-3237-417a-a22f-1fc2cd89272a','56074867-fdc2-4ce5-8e97-cea431decc36');
commit;
