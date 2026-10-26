-- 운영지원팀(조직 관리 담당)에게 멤버 목록 조회만 허용한다.
-- 가입 승인·계정 관리는 app.can_manage_personnel() 그대로이며 넓히지 않는다.

create or replace function app.can_view_members()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    app.is_admin()
    or app.is_company_manager()
    or app.can_manage_personnel()
    or app.can_edit_org_assignment();
$function$;

revoke all on function app.can_view_members() from public, anon;
grant execute on function app.can_view_members() to authenticated;

-- 멤버 화면의 브랜드 책임자 표시가 조회 권한과 같이 보이도록 맞춘다.
alter policy brand_members_select_related on public.brand_members
using (
  profile_id = auth.uid()
  or app.is_admin()
  or app.is_brand_lead(brand_id)
  or app.can_view_members()
  or (
    profile_id in (
      select p.id
      from public.profiles p
      where p.company_id = (select app.company_review_company_id())
    )
    and brand_id in (
      select b.id
      from public.brands b
      where b.company_id = (select app.company_review_company_id())
    )
  )
);
