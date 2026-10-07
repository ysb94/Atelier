-- Personal display preferences only; these rows never grant access to business data.
create table public.md_mall_display_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  target_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, brand_id),
  check (cardinality(target_ids) <= 500 and array_position(target_ids, null) is null)
);
create index md_mall_display_preferences_brand_idx on public.md_mall_display_preferences(brand_id);
alter table public.md_mall_display_preferences enable row level security;
revoke all on public.md_mall_display_preferences from anon;
grant select, insert, update on public.md_mall_display_preferences to authenticated;
create policy md_mall_display_read on public.md_mall_display_preferences for select to authenticated
using (user_id = (select auth.uid()) and app.can_read_brand(brand_id));
create policy md_mall_display_insert on public.md_mall_display_preferences for insert to authenticated
with check (user_id = (select auth.uid()) and app.can_read_brand(brand_id));
create policy md_mall_display_update on public.md_mall_display_preferences for update to authenticated
using (user_id = (select auth.uid()) and app.can_read_brand(brand_id))
with check (user_id = (select auth.uid()) and app.can_read_brand(brand_id));

create function app.validate_md_mall_display_preferences() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from unnest(new.target_ids) as requested(id)
    where not exists (select 1 from public.code_usage_targets t where t.id = requested.id and t.brand_id = new.brand_id)
  ) then
    raise exception '표시 업체는 같은 브랜드에 등록된 업체여야 합니다.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.validate_md_mall_display_preferences() from public, anon, authenticated;
create trigger validate_md_mall_display_preferences before insert or update
on public.md_mall_display_preferences for each row execute function app.validate_md_mall_display_preferences();
