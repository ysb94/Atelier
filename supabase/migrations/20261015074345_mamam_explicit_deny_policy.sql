-- Keep the temporary public table explicitly deny-all for API roles.
-- Submission writes only go through the validated public RPC wrappers.
drop policy if exists mamam_idea_submissions_deny_public
  on public.mamam_idea_submissions;
create policy mamam_idea_submissions_deny_public
on public.mamam_idea_submissions
for all
to anon, authenticated
using (false)
with check (false);
