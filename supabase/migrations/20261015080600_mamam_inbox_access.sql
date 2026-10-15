-- Mamam idea contest inbox access.
-- Only the active developer account and active CEO may read completed entries
-- and their private images from the authenticated Atelier application.

create or replace function app.mamam_inbox_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.company_id
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.status = 'active'
    and (
      lower(profile.email) = 'dev@atelier.local'
      or profile.position = '대표이사'
    )
  limit 1;
$function$;

revoke all on function app.mamam_inbox_company_id()
  from public, anon, authenticated;
grant execute on function app.mamam_inbox_company_id()
  to authenticated;

grant select on table public.mamam_idea_submissions to authenticated;

drop policy if exists mamam_idea_submissions_inbox_read
  on public.mamam_idea_submissions;
create policy mamam_idea_submissions_inbox_read
on public.mamam_idea_submissions
for select
to authenticated
using (
  status = 'submitted'
  and company_id = (select app.mamam_inbox_company_id())
);

create or replace function app.can_read_mamam_idea_image(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.mamam_idea_submissions submission
    where submission.id::text = split_part(p_object_name, '/', 1)
      and submission.status = 'submitted'
      and submission.company_id = (select app.mamam_inbox_company_id())
  );
$function$;

revoke all on function app.can_read_mamam_idea_image(text)
  from public, anon, authenticated;
grant execute on function app.can_read_mamam_idea_image(text)
  to authenticated;

drop policy if exists mamam_idea_images_inbox_read on storage.objects;
create policy mamam_idea_images_inbox_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'mamam-idea-images'
  and app.can_read_mamam_idea_image(name)
);
