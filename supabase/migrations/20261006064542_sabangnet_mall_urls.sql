-- 업체 이름이 아니라 UUID로 연결하며 사방넷 상품/M번호를 수정하지 않는다.
create table public.sabangnet_mall_urls (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id),
 product_id uuid not null,
 target_id uuid not null,
 url text not null check (url ~ '^https?://[^[:space:]/]+'),
 mall_product_code text not null default '',
 source_mall text not null default '',
 source_file text not null default '',
 source_row integer not null check (source_row > 0),
 created_at timestamptz not null default now(),
 unique (brand_id, product_id, target_id),
 foreign key (brand_id, product_id) references public.sabangnet_products(brand_id,id) on delete cascade,
 foreign key (brand_id, target_id) references public.code_usage_targets(brand_id,id) on delete restrict
);
create index sabangnet_mall_urls_target_idx on public.sabangnet_mall_urls(brand_id,target_id);
alter table public.sabangnet_mall_urls enable row level security;
grant select, insert on public.sabangnet_mall_urls to authenticated;
revoke all on public.sabangnet_mall_urls from anon;
create policy mall_urls_read on public.sabangnet_mall_urls for select to authenticated using (app.can_read_brand(brand_id));
create policy mall_urls_insert on public.sabangnet_mall_urls for insert to authenticated with check (
 app.can_edit_brand(brand_id) and exists (
  with recursive path as (
   select f.id,f.parent_id,f.name from public.code_usage_targets t join public.code_usage_target_folders f on f.id=t.folder_id and f.brand_id=t.brand_id
   where t.id=target_id and t.brand_id=sabangnet_mall_urls.brand_id and t.active
   union all select f.id,f.parent_id,f.name from public.code_usage_target_folders f join path p on f.id=p.parent_id
  ) select 1 from path where parent_id is null and name='온라인'
 )
);

create function public.import_sabangnet_mall_urls(p_brand_id uuid, p_source_file text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_inserted integer; v_unchanged integer; v_total integer; v_valid integer;
begin
 if not app.can_edit_brand(p_brand_id) then raise exception 'URL 등록 권한이 없습니다.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>30000 then raise exception 'URL 파일은 최대 30,000행입니다.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sabangnet-mall-urls:'||p_brand_id::text,0));
 -- 직접 호출해도 동일 업체/상품의 서로 다른 URL을 임의 선택하지 않는다.
 with raw as (
  select * from jsonb_to_recordset(p_rows) as r(product_id uuid,target_id uuid,url text,mall_product_code text,source_mall text,source_row integer)
 ), conflicted as (
  select product_id,target_id from raw group by product_id,target_id having count(distinct url)>1
 ), valid as (
  select distinct on (r.product_id,r.target_id) r.* from raw r
  join public.sabangnet_products p on p.id=r.product_id and p.brand_id=p_brand_id
  join public.code_usage_targets t on t.id=r.target_id and t.brand_id=p_brand_id and t.active
  where r.url ~ '^https?://[^[:space:]/]+' and r.url !~ '[[:space:]]' and r.url !~ '^https?://[^/]*@' and r.source_row>0
   and not exists(select 1 from conflicted c where c.product_id=r.product_id and c.target_id=r.target_id)
   and exists (
    with recursive path as (
     select f.id,f.parent_id,f.name from public.code_usage_target_folders f where f.id=t.folder_id and f.brand_id=p_brand_id
     union all select f.id,f.parent_id,f.name from public.code_usage_target_folders f join path p on f.id=p.parent_id and f.brand_id=p_brand_id
    ) select 1 from path where parent_id is null and name='온라인'
   )
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
