-- Member review must display capabilities/stewardships accurately; writes unchanged.
alter policy profile_capabilities_select on public.profile_capabilities
using (profile_id=auth.uid() or app.can_view_members()
  or profile_id in(select p.id from public.profiles p where p.company_id=(select app.company_review_company_id())));

alter policy brand_members_select_related on public.brand_members
using (profile_id=auth.uid() or app.is_admin() or app.is_brand_lead(brand_id)
  or (profile_id in(select p.id from public.profiles p where p.company_id=(select app.company_review_company_id()))
    and brand_id in(select b.id from public.brands b where b.company_id=(select app.company_review_company_id()))));
