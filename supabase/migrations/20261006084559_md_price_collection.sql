-- Additive pilot storage; existing products, URLs and event examples are unchanged.
create unique index if not exists sabangnet_mall_urls_brand_id_id_price_key on public.sabangnet_mall_urls(brand_id,id);
create table public.md_price_rules (
 id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id),
 target_id uuid not null, domain text not null, rule jsonb not null,
 state text not null default 'trial' check (state in ('trial','verified','needs_review')),
 validated_url_ids uuid[] not null default '{}', updated_at timestamptz not null default now(),
 unique(brand_id,target_id,domain),
 foreign key(brand_id,target_id) references public.code_usage_targets(brand_id,id)
);
create table public.md_price_checks (
 id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id),
 url_id uuid not null, checked_at timestamptz not null default now(),
 status text not null check(status in ('ok','sold_out','ended','blocked','unknown','failed')),
 price integer check(price > 0), currency text not null default 'KRW',
 source text not null check(source in ('rule','discovered','ai','none')),
 basis text not null default '', message text not null default '',
 rule_state text, evidence text not null default '', page_name text not null default '',
 option_verified boolean not null default false,
 foreign key(brand_id,url_id) references public.sabangnet_mall_urls(brand_id,id),
 check(status = 'ok' or price is null)
);
create index md_price_checks_latest on public.md_price_checks(brand_id,url_id,checked_at desc);
alter table public.md_price_rules enable row level security;
alter table public.md_price_checks enable row level security;
revoke all on public.md_price_rules, public.md_price_checks from anon, authenticated;
grant select on public.md_price_rules, public.md_price_checks to authenticated;
grant all on public.md_price_rules, public.md_price_checks to service_role;
create policy md_price_rules_read on public.md_price_rules for select to authenticated using(app.can_read_brand(brand_id));
create policy md_price_checks_read on public.md_price_checks for select to authenticated using(app.can_read_brand(brand_id));
create function public.md_price_can_refresh(p_brand_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select app.can_edit_brand(p_brand_id)
$$;
revoke all on function public.md_price_can_refresh(uuid) from public, anon;
grant execute on function public.md_price_can_refresh(uuid) to authenticated;
-- Service-only leases prevent concurrent staff requests from duplicating collection/AI charges.
create table public.md_price_collection_leases (
 scope text primary key, expires_at timestamptz not null
);
alter table public.md_price_collection_leases enable row level security;
revoke all on public.md_price_collection_leases from anon, authenticated;
grant all on public.md_price_collection_leases to service_role;
create function public.md_price_claim(p_scope text,p_seconds integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_scope text;
begin
 insert into public.md_price_collection_leases(scope,expires_at) values(p_scope,now()+make_interval(secs=>least(greatest(p_seconds,1),300)))
 on conflict(scope) do update set expires_at=excluded.expires_at where md_price_collection_leases.expires_at < now()
 returning scope into v_scope;
 return v_scope is not null;
end $$;
revoke all on function public.md_price_claim(text,integer) from public,anon,authenticated;
grant execute on function public.md_price_claim(text,integer) to service_role;
insert into public.ai_feature_routes(brand_id,feature_key,provider,model_id,is_active)
 select brand_id,'md_price_rule_discovery',provider,model_id,is_active from public.ai_feature_routes
 where feature_key='invoice_product_recommendation' and provider='openai'
 on conflict(brand_id,feature_key) do nothing;
