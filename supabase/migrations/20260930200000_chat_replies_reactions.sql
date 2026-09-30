-- Replies remain in the same room. A deleted parent keeps its reply context
-- until the parent itself is physically removed.
alter table public.chat_messages
  add column reply_to_message_id uuid;

alter table public.chat_messages
  add constraint chat_messages_room_id_id_key unique (room_id, id),
  add constraint chat_messages_reply_not_self_check
    check (reply_to_message_id is null or reply_to_message_id <> id),
  add constraint chat_messages_reply_same_room_fkey
    foreign key (room_id, reply_to_message_id)
    references public.chat_messages (room_id, id)
    on delete set null (reply_to_message_id);

create index chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create table public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id),
  constraint chat_message_reactions_emoji_check
    check (emoji in ('❤️', '👍', '✅', '😍', '😮', '😭'))
);

create index chat_message_reactions_profile_idx
  on public.chat_message_reactions (profile_id);

alter table public.chat_message_reactions enable row level security;

create policy chat_message_reactions_select
on public.chat_message_reactions
for select to authenticated
using (
  exists (
    select 1 from public.chat_messages msg
    where msg.id = message_id
      and app.is_chat_room_member(msg.room_id)
  )
);

create policy chat_message_reactions_insert
on public.chat_message_reactions
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.chat_messages msg
    where msg.id = message_id
      and msg.deleted_at is null
      and msg.kind <> 'system'
      and app.is_chat_room_member(msg.room_id)
  )
);

create policy chat_message_reactions_update
on public.chat_message_reactions
for update to authenticated
using (profile_id = (select auth.uid()))
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.chat_messages msg
    where msg.id = message_id
      and msg.deleted_at is null
      and msg.kind <> 'system'
      and app.is_chat_room_member(msg.room_id)
  )
);

create policy chat_message_reactions_delete
on public.chat_message_reactions
for delete to authenticated
using (profile_id = (select auth.uid()));

revoke all on table public.chat_message_reactions from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_message_reactions to authenticated;
grant select, insert, update, delete on table public.chat_message_reactions to service_role;

do $publication$
begin
  begin
    alter publication supabase_realtime add table public.chat_message_reactions;
  exception when duplicate_object then null;
  end;
end;
$publication$;
