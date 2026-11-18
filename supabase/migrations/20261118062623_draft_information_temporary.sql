create table public.draft_information_temporary (
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete cascade,
  field text not null check (field in ('size', 'fabric', 'specDoc')),
  color_id uuid,
  revision uuid not null,
  edits jsonb not null check (jsonb_typeof(edits) = 'object'),
  unique nulls not distinct (draft_id, editor_id, field, color_id),
  check ((field = 'specDoc') = (color_id is null))
);

alter table public.draft_information_temporary enable row level security;
revoke all on public.draft_information_temporary from public, anon, authenticated;
grant select, insert, update, delete on public.draft_information_temporary to authenticated;

-- The draft save RPC replaces its color rows in a transaction. A color FK
-- would discard working copies even when that save reinserts the same color.
create policy draft_information_temporary_owner on public.draft_information_temporary
  for all to authenticated
  using (editor_id = (select auth.uid()) and app.draft_write_allowed(draft_id))
  with check (
    editor_id = (select auth.uid()) and app.draft_write_allowed(draft_id)
    and (color_id is null or exists (
      select 1 from public.draft_colors c
      where c.id = draft_information_temporary.color_id and c.draft_id = draft_information_temporary.draft_id
    ))
  );

create function public.save_product_draft_information(
  p_company_id uuid, p_brand_id uuid, p_id uuid, p_payload jsonb, p_colors jsonb, p_options jsonb,
  p_temporary_revision uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  v_id := public.save_product_draft(p_company_id, p_brand_id, p_id, p_payload, p_colors, p_options);
  delete from public.draft_information_temporary
  where draft_id = v_id and editor_id = auth.uid() and revision = p_temporary_revision;
  return v_id;
end $$;

revoke all on function public.save_product_draft_information(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_product_draft_information(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid)
  to authenticated;
