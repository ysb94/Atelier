create table app.personal_work_cards (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  created_by uuid not null references public.profiles(id),
  assignee_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) <= 10000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'feedback', 'done')),
  round integer not null default 1 check (round > 0),
  revision integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  events jsonb not null default '[]',
  create_command uuid not null,
  last_command uuid not null,
  last_actor uuid not null
);

alter table app.personal_work_cards enable row level security;
revoke all on app.personal_work_cards from public, anon, authenticated;

create index personal_work_cards_assignee_idx on app.personal_work_cards (company_id, assignee_id) where deleted_at is null;
create index personal_work_cards_creator_idx on app.personal_work_cards (company_id, created_by) where deleted_at is null;
create index personal_work_cards_reviewer_idx on app.personal_work_cards (company_id, reviewer_id) where deleted_at is null and status = 'feedback';

create function app.list_personal_work_cards() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', card.id, 'title', card.title, 'description', card.description,
    'status', card.status, 'round', card.round, 'revision', card.revision,
    'created_at', card.created_at, 'events', card.events,
    'created_by', card.created_by, 'creator_name', creator.display_name,
    'assignee_id', card.assignee_id, 'assignee_name', assignee.display_name,
    'reviewer_id', card.reviewer_id, 'reviewer_name', reviewer.display_name
  ) order by card.created_at desc, card.id), '[]'::jsonb)
  from public.profiles actor
  join app.personal_work_cards card on card.company_id = actor.company_id
  join public.profiles creator on creator.id = card.created_by
  join public.profiles assignee on assignee.id = card.assignee_id
  left join public.profiles reviewer on reviewer.id = card.reviewer_id
  where actor.id = auth.uid() and actor.status = 'active' and card.deleted_at is null
    and (card.assignee_id = actor.id or card.created_by = actor.id
      or (card.reviewer_id = actor.id and card.status = 'feedback'));
$$;

create function app.list_personal_work_members() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', member.id, 'name', member.display_name,
    'position', member.position) order by member.display_name, member.id), '[]'::jsonb)
  from public.profiles actor
  join public.profiles member on member.company_id = actor.company_id and member.department_id = actor.department_id
  where actor.id = auth.uid() and actor.status = 'active' and member.status = 'active' and member.id <> actor.id;
$$;

create function app.personal_work_action(
  p_id uuid, p_command uuid, p_action text, p_revision integer default null,
  p_title text default null, p_description text default null, p_assignee uuid default null,
  p_reviewer uuid default null, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  card app.personal_work_cards%rowtype;
  assignee uuid;
  reviewer uuid;
  notified uuid;
  room uuid;
  event_kind text;
  next_status text;
  next_round integer;
  note text := nullif(btrim(p_note), '');
  next_title text := btrim(p_title);
  next_description text := coalesce(p_description, '');
  event_time timestamptz;
  message_title text;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active' and company_id is not null;
  if not found or p_id is null or p_command is null then
    raise exception '업무를 처리할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action in ('create', 'edit') and (next_title is null or char_length(next_title) not between 1 and 120
      or char_length(next_description) > 10000) then
    raise exception '업무 제목과 내용의 길이를 확인해 주세요.' using errcode = '22023';
  end if;
  if char_length(note) > 3600 then
    raise exception '피드백은 3,600자까지 입력할 수 있습니다.' using errcode = '22023';
  end if;

  if p_action = 'create' then
    assignee := coalesce(p_assignee, actor.id);
    if assignee <> actor.id then
      if not exists (select 1 from public.profiles where id = assignee and status = 'active'
          and company_id = actor.company_id and department_id = actor.department_id) then
        raise exception '같은 부서의 활성 직원에게만 업무를 배정할 수 있습니다.' using errcode = '42501';
      end if;
      reviewer := actor.id;
      notified := assignee;
      message_title := '[내 업무 배정]';
    end if;
    event_time := clock_timestamp();
    insert into app.personal_work_cards (id, company_id, created_by, assignee_id, reviewer_id, title, description,
      created_at, updated_at, create_command, last_command, last_actor)
    values (p_id, actor.company_id, actor.id, assignee, reviewer, next_title, next_description,
      event_time, event_time, p_command, p_command, actor.id)
    on conflict (id) do nothing returning * into card;
    if not found then
      if exists (select 1 from app.personal_work_cards where id = p_id and company_id = actor.company_id
          and created_by = actor.id and create_command = p_command) then return; end if;
      raise exception '업무를 추가할 수 없습니다. 다시 열어 주세요.' using errcode = '40001';
    end if;
  else
    select * into card from app.personal_work_cards
      where id = p_id and company_id = actor.company_id
        and (assignee_id = actor.id or created_by = actor.id or (reviewer_id = actor.id and status = 'feedback')
          or (last_actor = actor.id and last_command = p_command))
      for update;
    if not found then raise exception '업무를 찾을 수 없습니다.' using errcode = '42501'; end if;
    if card.last_command = p_command and card.last_actor = actor.id then return; end if;
    if card.deleted_at is not null or (actor.id <> card.assignee_id and actor.id <> card.created_by
        and not (card.status = 'feedback' and card.reviewer_id is not distinct from actor.id)) then
      raise exception '업무를 처리할 권한이 없습니다.' using errcode = '42501';
    end if;
    if p_revision is distinct from card.revision then
      raise exception '업무가 다른 화면에서 변경되었습니다. 최신 상태를 확인해 주세요.' using errcode = '40001';
    end if;
    event_time := clock_timestamp();
    next_status := card.status;
    next_round := card.round;
    reviewer := card.reviewer_id;
    case p_action
      when 'edit' then
        if card.status = 'feedback' or actor.id not in (card.created_by, card.assignee_id) then
          raise exception '피드백 대기 중에는 업무 내용을 수정할 수 없습니다.' using errcode = '42501';
        end if;
      when 'delete' then
        if actor.id <> card.created_by or card.status = 'feedback' then
          raise exception '등록한 업무만 삭제할 수 있으며 피드백 대기 중에는 삭제할 수 없습니다.' using errcode = '42501';
        end if;
      when 'start' then
        if actor.id = card.assignee_id and card.status = 'todo' then
          next_status := 'doing';
          event_kind := case when card.events @> jsonb_build_array(jsonb_build_object('kind', 'started', 'round', card.round))
            then 'resumed' else 'started' end;
        end if;
      when 'pause' then
        if actor.id = card.assignee_id and card.status = 'doing' then
          next_status := 'todo'; event_kind := 'paused';
        end if;
      when 'submit' then
        if actor.id = card.assignee_id and card.status = 'doing' then
          reviewer := case when card.created_by <> card.assignee_id then card.created_by else p_reviewer end;
          if reviewer is null or reviewer = actor.id or not exists (select 1 from public.profiles
              where id = reviewer and company_id = actor.company_id and status = 'active') then
            raise exception '피드백을 받을 활성 직원을 확인해 주세요.' using errcode = '42501';
          end if;
          next_status := 'feedback'; event_kind := 'submitted';
          notified := reviewer; message_title := '[내 업무 피드백 요청]';
        end if;
      when 'complete' then
        if actor.id = card.assignee_id and actor.id = card.created_by and card.status = 'doing' then
          next_status := 'done'; event_kind := 'completed';
        end if;
      when 'approve', 'revise' then
        if actor.id = reviewer and card.status = 'feedback' then
          if p_action = 'revise' and note is null then
            raise exception '수정할 내용을 입력해 주세요.' using errcode = '22023';
          end if;
          if p_action = 'revise' then
            next_status := 'todo'; next_round := card.round + 1; event_kind := 'revision_requested';
            message_title := '[내 업무 수정 요청]';
          else
            next_status := 'done'; event_kind := 'approved'; message_title := '[내 업무 승인]';
          end if;
          notified := card.assignee_id;
        end if;
      else
        raise exception '지원하지 않는 업무 처리입니다.' using errcode = '22023';
    end case;
    if event_kind is null and p_action not in ('edit', 'delete') then
      raise exception '현재 상태에서 이 작업을 처리할 수 없습니다.' using errcode = '42501';
    end if;
    update app.personal_work_cards set
      status = next_status, round = next_round, reviewer_id = reviewer,
      title = case when p_action = 'edit' then next_title else title end,
      description = case when p_action = 'edit' then next_description else description end,
      deleted_at = case when p_action = 'delete' then event_time else deleted_at end,
      events = case when event_kind is null then events else events || jsonb_build_array(jsonb_build_object(
        'kind', event_kind, 'round', card.round, 'at', event_time, 'actor_id', actor.id, 'note', note)) end,
      revision = revision + 1, updated_at = event_time, last_command = p_command, last_actor = actor.id
    where id = card.id returning * into card;
  end if;

  if notified is not null and exists (select 1 from public.profiles where id = notified
      and status = 'active' and company_id = actor.company_id) then
    room := public.open_direct_chat(notified);
    insert into public.chat_messages (id, room_id, kind, body)
    values (p_command, room, 'text', concat_ws(E'\n\n', message_title, card.title, note,
      'My home → 내 업무'));
  end if;
end;
$$;

create function public.list_personal_work_cards() returns jsonb
language sql stable set search_path = '' as $$ select app.list_personal_work_cards(); $$;

create function public.list_personal_work_members() returns jsonb
language sql stable set search_path = '' as $$ select app.list_personal_work_members(); $$;

create function public.personal_work_action(
  p_id uuid, p_command uuid, p_action text, p_revision integer default null,
  p_title text default null, p_description text default null, p_assignee uuid default null,
  p_reviewer uuid default null, p_note text default null
) returns void language sql set search_path = '' as $$
  select app.personal_work_action(p_id, p_command, p_action, p_revision, p_title, p_description, p_assignee, p_reviewer, p_note);
$$;

revoke all on function app.list_personal_work_cards() from public, anon;
revoke all on function app.list_personal_work_members() from public, anon;
revoke all on function app.personal_work_action(uuid, uuid, text, integer, text, text, uuid, uuid, text) from public, anon;
grant execute on function app.list_personal_work_cards() to authenticated;
grant execute on function app.list_personal_work_members() to authenticated;
grant execute on function app.personal_work_action(uuid, uuid, text, integer, text, text, uuid, uuid, text) to authenticated;

revoke all on function public.list_personal_work_cards() from public, anon;
revoke all on function public.list_personal_work_members() from public, anon;
revoke all on function public.personal_work_action(uuid, uuid, text, integer, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.list_personal_work_cards() to authenticated;
grant execute on function public.list_personal_work_members() to authenticated;
grant execute on function public.personal_work_action(uuid, uuid, text, integer, text, text, uuid, uuid, text) to authenticated;
