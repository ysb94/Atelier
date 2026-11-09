-- A current recipient may open only requests actually shared with them by a nudge.
create function app.is_material_nudge_recipient(p_company uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select from public.material_nudge_recipients s
    where s.company_id=p_company and s.profile_id=(select auth.uid()))
$$;

create function app.material_nudge_workspace(p_scope text,p_id uuid,p_round integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_can_view boolean;
  v_request uuid := p_id;
  v_read_at timestamptz;
  v_requests jsonb;
begin
  if p_scope is null or p_scope not in ('inbox','list','notice','request')
    or (p_scope in ('notice','request')) is distinct from (p_id is not null)
    or (p_round is not null and (p_id is null or p_round < 1)) then
    raise exception '조회할 자재요청을 확인해 주세요.' using errcode='22023';
  end if;
  if v_actor is null or v_company is null then
    raise exception '자재요청을 볼 수 있는 계정이 아닙니다.' using errcode='42501';
  end if;
  v_can_view := app.is_material_nudge_recipient(v_company);

  if p_scope='inbox' then
    -- Keep the previous notification history and shape. The link is active only while accessible.
    return jsonb_build_object('can_view',v_can_view,'notices',coalesce((
      select jsonb_agg(to_jsonb(n)||jsonb_build_object(
        'can_open',v_can_view and q.id is not null
      ) order by (n.read_at is null) desc,n.created_at desc,n.id)
      from app.list_my_material_nudges() n
      join app.material_nudge_notices target on target.id=n.id
      left join app.material_requests q on q.id=target.request_id and q.company_id=v_company and q.deleted_at is null
    ),'[]'::jsonb));
  end if;
  if not v_can_view then
    raise exception '조르기 수신자에게만 공개된 자재요청입니다.' using errcode='42501';
  end if;
  if p_scope='notice' then
    select n.request_id,n.read_at into v_request,v_read_at from app.material_nudge_notices n
    where n.id=p_id and n.company_id=v_company and n.recipient_id=v_actor;
    if not found then
      raise exception '이 알림에서 자재요청을 열 수 없습니다.' using errcode='42501';
    end if;
  end if;

  select coalesce(jsonb_agg(items.request order by items.updated_at desc,items.id),'[]'::jsonb) into v_requests
  from (
    select q.id,q.updated_at,jsonb_build_object(
      'id',q.id,'ownerId',q.owner_id,'ownerName',p.display_name,'title',q.title,
      'brandId',coalesce(q.brand_id::text,''),
      'status',case q.status when 'completed' then '완료' when 'requested' then '요청중' else '요청예정' end,
      'draftStage',q.draft_stage,
      'blocks',case when p_scope<>'list' and p_round is null and q.status='planned' and q.draft_stage in ('writing','ready')
        then q.blocks else '[]'::jsonb end,
      'rounds',coalesce((
        select jsonb_agg(app.material_round_json(r,p_scope<>'list' and r.round_no=coalesce(
          p_round,case when not (q.status='planned' and q.draft_stage in ('writing','ready')) then latest.round_no end
        ))-'satisfaction' order by r.round_no)
        from app.material_request_rounds r where r.request_id=q.id
      ),'[]'::jsonb)
    ) as request
    from app.material_requests q join public.profiles p on p.id=q.owner_id
    left join lateral (
      select r.round_no from app.material_request_rounds r where r.request_id=q.id order by r.round_no desc limit 1
    ) latest on p_scope<>'list'
    where q.company_id=v_company and q.deleted_at is null
      and (p_scope='list' or q.id=v_request)
      and exists(select from app.material_nudge_notices n
        where n.company_id=v_company and n.recipient_id=v_actor and n.request_id=q.id)
  ) items;

  if p_scope='list' then return v_requests; end if;
  if jsonb_array_length(v_requests)=0 then
    raise exception '이 자재요청을 열 수 없습니다.' using errcode='42501';
  end if;
  if p_round is not null and not exists(select from jsonb_array_elements(v_requests->0->'rounds') r
    where (r->>'number')::int=p_round) then
    raise exception '조회할 회차가 없습니다.' using errcode='22023';
  end if;
  return jsonb_build_object('request',v_requests->0,'read_at',v_read_at);
end $$;

create function public.material_nudge_workspace(p_scope text default 'inbox',p_id uuid default null,p_round integer default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app.material_nudge_workspace(p_scope,p_id,p_round)
$$;

create function app.material_nudge_attachment_read(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select from app.material_requests q
    where q.id=case when split_part(p_name,'/',2) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then split_part(p_name,'/',2)::uuid end
      and q.owner_id::text=split_part(p_name,'/',1)
      and q.company_id=(select app.permission_company_id()) and q.deleted_at is null
      and app.is_material_nudge_recipient(q.company_id)
      and exists(select from app.material_nudge_notices n
        where n.company_id=q.company_id and n.recipient_id=(select auth.uid()) and n.request_id=q.id)
      and (
        (q.status='planned' and q.draft_stage in ('writing','ready') and
          q.blocks @> jsonb_build_array(jsonb_build_object('path',p_name)))
        or exists(select from app.material_request_rounds r
          where r.request_id=q.id and r.blocks @> jsonb_build_array(jsonb_build_object('path',p_name)))
      )
  )
$$;

revoke all on function app.is_material_nudge_recipient(uuid),app.material_nudge_workspace(text,uuid,integer),
  public.material_nudge_workspace(text,uuid,integer),app.material_nudge_attachment_read(text) from public,anon,authenticated;
grant execute on function app.material_nudge_workspace(text,uuid,integer),public.material_nudge_workspace(text,uuid,integer),
  app.material_nudge_attachment_read(text) to authenticated;

create policy material_nudge_attachment_read on storage.objects for select to authenticated
using (bucket_id='material-request-files' and app.material_nudge_attachment_read(name));
