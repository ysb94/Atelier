alter policy mall_urls_read on public.sabangnet_mall_urls using (brand_id in (select b.id from public.brands b where app.can_read_brand(b.id)));
alter policy mall_urls_insert on public.sabangnet_mall_urls with check (
 brand_id in (select b.id from public.brands b where app.can_edit_brand(b.id))
 and target_id in (
  with recursive online_folders as (
   select id,brand_id from public.code_usage_target_folders where parent_id is null and name='온라인'
   union all select f.id,f.brand_id from public.code_usage_target_folders f join online_folders p on f.parent_id=p.id and f.brand_id=p.brand_id
  ) select t.id from public.code_usage_targets t join online_folders f on f.id=t.folder_id and f.brand_id=t.brand_id where t.active
 )
);
create or replace function public.import_sabangnet_mall_urls(p_brand_id uuid, p_source_file text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_inserted integer; v_unchanged integer; v_total integer; v_valid integer;
begin
 if not app.can_edit_brand(p_brand_id) then raise exception 'URL 등록 권한이 없습니다.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>30000 then raise exception 'URL 파일은 최대 30,000행입니다.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sabangnet-mall-urls:'||p_brand_id::text,0));
 -- 직접 호출해도 동일 업체/상품의 서로 다른 URL을 임의 선택하지 않는다.
 with recursive online_folders as materialized (
 select id,brand_id from public.code_usage_target_folders where brand_id=p_brand_id and parent_id is null and name='온라인'
 union all select f.id,f.brand_id from public.code_usage_target_folders f join online_folders p on f.parent_id=p.id and f.brand_id=p.brand_id
 ), online_targets as materialized (
 select t.id from public.code_usage_targets t join online_folders f on f.id=t.folder_id where t.brand_id=p_brand_id and t.active
 ), product_ids as materialized (
 select id from public.sabangnet_products where brand_id=p_brand_id
 ), raw as materialized (
  select * from jsonb_to_recordset(p_rows) as r(product_id uuid,target_id uuid,url text,mall_product_code text,source_mall text,source_row integer)
 ), conflicted as (
  select product_id,target_id from raw group by product_id,target_id having count(distinct url)>1
 ), valid as (
  select distinct on (r.product_id,r.target_id) r.* from raw r
  join product_ids p on p.id=r.product_id
  join online_targets t on t.id=r.target_id
  where r.url ~ '^https?://[^[:space:]/]+' and r.url !~ '[[:space:]]' and r.url !~ '^https?://[^/]*@' and r.source_row>0
   and not exists(select 1 from conflicted c where c.product_id=r.product_id and c.target_id=r.target_id)

  order by r.product_id,r.target_id,r.source_row
 ), inserted as (
  insert into public.sabangnet_mall_urls(brand_id,product_id,target_id,url,mall_product_code,source_mall,source_file,source_row)
  select p_brand_id,product_id,target_id,url,coalesce(mall_product_code,''),coalesce(source_mall,''),coalesce(p_source_file,''),source_row from valid
  on conflict (brand_id,product_id,target_id) do nothing returning id
 )
 select (select count(*) from inserted),
  (select count(*) from valid v join public.sabangnet_mall_urls u on u.brand_id=p_brand_id and u.product_id=v.product_id and u.target_id=v.target_id and u.url=v.url),
  (select count(*) from raw), (select count(*) from valid)
 into v_inserted,v_unchanged,v_total,v_valid;
 return jsonb_build_object('inserted',v_inserted,'unchanged',v_unchanged,'held',v_total-v_inserted-v_unchanged);
end;
$$;
revoke all on function public.import_sabangnet_mall_urls(uuid,text,jsonb) from public, anon;
grant execute on function public.import_sabangnet_mall_urls(uuid,text,jsonb) to authenticated;


