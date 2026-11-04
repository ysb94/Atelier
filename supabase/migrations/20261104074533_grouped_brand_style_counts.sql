-- Prepared locally; apply only after explicit shared-DB approval.
-- Abort if the existing SELECT boundary changes before deployment.
do $$ begin
  if (select count(*) from pg_policies where schemaname='public' and tablename='styles'
      and cmd in ('ALL','SELECT')) <> 1
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='styles'
       and policyname='styles_all_member' and cmd='ALL' and qual='app.can_read_brand(brand_id)') then
    raise exception 'styles read policy changed; revalidate count boundary';
  end if;
end $$;

create function public.count_brand_styles(p_brand_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if cardinality(p_brand_ids)>200 then raise exception 'Too many brands' using errcode='22023'; end if;
  -- Evaluate the existing SELECT permission once per brand, not once per SKU.
  with requested as materialized (
    select distinct id from unnest(p_brand_ids) id where id is not null
  ), allowed as materialized (
    select id, app.can_read_brand(id) permitted from requested
  ), counts as (
    select a.id, (select count(*) from public.styles s where s.brand_id=a.id and a.permitted) total
    from allowed a
  ) select coalesce(jsonb_object_agg(id::text,total),'{}'::jsonb) into result from counts;
  return result;
end $$;
revoke all on function public.count_brand_styles(uuid[]) from public, anon;
grant execute on function public.count_brand_styles(uuid[]) to authenticated;
