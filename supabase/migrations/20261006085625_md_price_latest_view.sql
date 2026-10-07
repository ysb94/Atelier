create policy md_price_leases_service on public.md_price_collection_leases for all to service_role using(true) with check(true);
create index md_price_checks_last_success on public.md_price_checks(brand_id,url_id,checked_at desc) where status='ok';
create view public.md_price_latest_checks with (security_invoker=true) as
 select distinct on(c.brand_id,c.url_id) c.*,
   success.price as last_success_price, success.checked_at as last_success_at
 from public.md_price_checks c
 left join lateral (
   select p.price,p.checked_at from public.md_price_checks p
   where p.brand_id=c.brand_id and p.url_id=c.url_id and p.status='ok'
   order by p.checked_at desc limit 1
 ) success on true
 order by c.brand_id,c.url_id,c.checked_at desc,c.id;
revoke all on public.md_price_latest_checks from anon;
grant select on public.md_price_latest_checks to authenticated;
