create table app.material_nudge_notices (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app.material_requests(id),
  event_id uuid not null,
  company_id uuid not null,
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (request_id, event_id, recipient_id)
);
create index material_nudge_notices_inbox on app.material_nudge_notices
  (recipient_id, company_id, (read_at is null) desc, created_at desc, id);
alter table app.material_nudge_notices enable row level security;
revoke all on app.material_nudge_notices from public, anon, authenticated;

create function app.send_material_nudge(p_request uuid, p_revision integer, p_recipients uuid[], p_event uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_request app.material_requests;
  v_sender text;
  v_recipients uuid[];
  v_sent integer;
begin
  if v_uid is null or v_company is null or not coalesce(app.basic_work_allowed('planning'),false) then
    raise exception '자재요청 알림을 보낼 권한이 없습니다.' using errcode='42501';
  end if;
  if p_event is null or p_revision is null or coalesce(cardinality(p_recipients),0) not between 1 and 10 then
    raise exception '요청과 받는 사람을 확인해 주세요.' using errcode='22023';
  end if;

  select * into v_request from app.material_requests q
  where q.id=p_request and q.company_id=v_company and q.owner_id=v_uid for update;
  if not found then raise exception '본인의 자재요청만 조르기 할 수 있습니다.' using errcode='42501'; end if;

  select count(*) into v_sent from app.material_nudge_notices n
  where n.request_id=p_request and n.event_id=p_event;
  if v_sent>0 then return v_sent; end if;

  if v_request.deleted_at is not null or v_request.status='completed' or v_request.revision<>p_revision then
    raise exception '자재요청이 변경되었습니다. 목록에서 다시 확인해 주세요.' using errcode='40001';
  end if;

  select array_agg(n.profile_id order by n.profile_id) into v_recipients
  from public.material_nudge_recipients n join public.profiles p on p.id=n.profile_id
  where n.company_id=v_company and p.company_id=v_company and p.status='active';
  if v_recipients is null or v_recipients is distinct from array(select id from unnest(p_recipients) as person(id) order by id) then
    raise exception '받는 사람이 변경되었습니다. 다시 확인해 주세요.' using errcode='40001';
  end if;

  select coalesce(nullif(btrim(display_name),''),'자재요청 작성자') into v_sender from public.profiles where id=v_uid;
  insert into app.material_nudge_notices(request_id,event_id,company_id,sender_id,recipient_id,sender_name,body)
  select p_request,p_event,v_company,v_uid,id,v_sender,
    format('「%s」 자재요청의 진행 상황을 확인해 주세요.',v_request.title)
  from unnest(v_recipients) as person(id);
  return cardinality(v_recipients);
end $$;

create function app.list_my_material_nudges()
returns table(id uuid, sender_name text, body text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path='' as $$
  select n.id,n.sender_name,n.body,n.created_at,n.read_at from app.material_nudge_notices n
  where n.recipient_id=(select auth.uid()) and n.company_id=(select app.permission_company_id())
  order by (n.read_at is null) desc,n.created_at desc,n.id limit 100
$$;

create function app.read_material_nudge(p_id uuid)
returns void language sql security definer set search_path='' as $$
  update app.material_nudge_notices n set read_at=now()
  where n.id=p_id and n.recipient_id=(select auth.uid())
    and n.company_id=(select app.permission_company_id()) and n.read_at is null
$$;

create function public.send_material_nudge(p_request uuid, p_revision integer, p_recipients uuid[], p_event uuid)
returns integer language sql security invoker set search_path='' as $$
  select app.send_material_nudge(p_request,p_revision,p_recipients,p_event)
$$;
create function public.list_my_material_nudges()
returns table(id uuid, sender_name text, body text, created_at timestamptz, read_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from app.list_my_material_nudges()$$;
create function public.read_material_nudge(p_id uuid)
returns void language sql security invoker set search_path='' as $$select app.read_material_nudge(p_id)$$;

revoke all on function app.send_material_nudge(uuid,integer,uuid[],uuid), app.list_my_material_nudges(), app.read_material_nudge(uuid),
  public.send_material_nudge(uuid,integer,uuid[],uuid), public.list_my_material_nudges(), public.read_material_nudge(uuid) from public,anon,authenticated;
grant execute on function app.send_material_nudge(uuid,integer,uuid[],uuid), app.list_my_material_nudges(), app.read_material_nudge(uuid),
  public.send_material_nudge(uuid,integer,uuid[],uuid), public.list_my_material_nudges(), public.read_material_nudge(uuid) to authenticated;
