create table public.personal_work_feedback_notices (
  id uuid primary key,
  company_id uuid not null,
  recipient_id uuid not null references public.profiles(id),
  card_id uuid not null references app.personal_work_cards(id),
  card_revision integer not null,
  round integer not null,
  title text not null,
  note text,
  requester_name text not null,
  created_at timestamptz not null,
  read_at timestamptz,
  resolved_at timestamptz,
  unique (card_id, card_revision)
);

create index personal_work_feedback_notices_recipient_recent
  on public.personal_work_feedback_notices (recipient_id, created_at desc, id);

alter table public.personal_work_feedback_notices enable row level security;
revoke all on public.personal_work_feedback_notices from public, anon, authenticated;
grant select on public.personal_work_feedback_notices to authenticated;
create policy personal_work_feedback_notices_recipient on public.personal_work_feedback_notices
  for select to authenticated using (
    recipient_id = (select auth.uid()) and company_id = (select app.permission_company_id())
  );

-- Keep the existing card validation, revision lock and command idempotency.
do $patch$
declare
  definition text := pg_get_functiondef('app.personal_work_action(uuid,uuid,text,integer,text,text,uuid,uuid,text)'::regprocedure);
  anchor constant text := '  if notified is not null and exists (select 1 from public.profiles where id = notified';
begin
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'Unexpected personal_work_action notification dispatch';
  end if;
  execute replace(definition, anchor, $dispatch$
  if p_action = 'submit' then
    insert into public.personal_work_feedback_notices
      (id, company_id, recipient_id, card_id, card_revision, round, title, note, requester_name, created_at)
    values
      (p_command, actor.company_id, notified, card.id, card.revision, card.round, card.title, note, actor.display_name, event_time);
  elsif p_action in ('approve', 'revise') then
    update public.personal_work_feedback_notices
    set resolved_at = event_time
    where card_id = card.id and card_revision = p_revision and recipient_id = actor.id and resolved_at is null;
  end if;

  if p_action <> 'submit' and notified is not null and exists (select 1 from public.profiles where id = notified$dispatch$);
end;
$patch$;

-- A client with this RPC never falls back to the old chat transport on an older database.
create function public.submit_personal_work_feedback(
  p_id uuid, p_command uuid, p_revision integer, p_reviewer uuid default null, p_note text default null
) returns void language sql set search_path = '' as $$
  select app.personal_work_action(p_id, p_command, 'submit', p_revision, null, null, null, p_reviewer, p_note);
$$;

create function app.read_personal_work_feedback_notice(p_id uuid, p_revision integer)
returns timestamptz language sql security definer set search_path = '' as $$
  update public.personal_work_feedback_notices
     set read_at = coalesce(read_at, clock_timestamp())
   where id = p_id and card_revision = p_revision
     and recipient_id = (select auth.uid()) and company_id = (select app.permission_company_id())
  returning read_at;
$$;

create function public.read_personal_work_feedback_notice(p_id uuid, p_revision integer)
returns timestamptz language sql set search_path = '' as $$
  select app.read_personal_work_feedback_notice(p_id, p_revision);
$$;

revoke all on function public.submit_personal_work_feedback(uuid, uuid, integer, uuid, text),
  app.read_personal_work_feedback_notice(uuid, integer), public.read_personal_work_feedback_notice(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.submit_personal_work_feedback(uuid, uuid, integer, uuid, text),
  app.read_personal_work_feedback_notice(uuid, integer), public.read_personal_work_feedback_notice(uuid, integer)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'personal_work_feedback_notices') then
    alter publication supabase_realtime add table public.personal_work_feedback_notices;
  end if;
end;
$$;

notify pgrst, 'reload schema';
