-- Material requests have their own storage and do not modify sample work orders.
create table app.material_requests (
  id uuid primary key,
  company_id uuid not null,
  owner_id uuid not null references public.profiles(id),
  brand_id uuid references public.brands(id),
  title text not null check (char_length(title) between 1 and 200),
  blocks jsonb not null default '[]',
  status text not null default 'planned' check (status in ('planned','requested','completed')),
  draft_stage text check (draft_stage in ('not-started','writing','ready')),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status='planned')=(draft_stage is not null))
);
create table app.material_request_rounds (
  request_id uuid not null references app.material_requests(id),
  round_no integer not null check (round_no > 0),
  brand_id uuid references public.brands(id),
  title text not null,
  blocks jsonb not null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  assignee_id uuid references public.profiles(id),
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  satisfaction integer check (satisfaction between 1 and 10),
  primary key (request_id,round_no),
  check (assignee_id is null or reviewed_at is not null),
  check (confirmed_at is null or assignee_id is not null),
  check (shipped_at is null or confirmed_at is not null),
  check (received_at is null or shipped_at is not null),
  check (satisfaction is null or received_at is not null)
);
create index material_requests_company_list on app.material_requests(company_id,updated_at desc,id) where deleted_at is null;
create index material_rounds_assignee on app.material_request_rounds(assignee_id,request_id,round_no) where assignee_id is not null;
alter table app.material_requests enable row level security;
alter table app.material_request_rounds enable row level security;
revoke all on app.material_requests,app.material_request_rounds from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('material-request-files','material-request-files',false,10485760,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp','image/tiff','image/heic','image/heif',
        'application/pdf','application/zip','application/x-zip-compressed','application/octet-stream','text/plain','text/csv',
        'application/vnd.ms-excel','application/msword','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

create function app.material_file_read(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from app.material_requests q
    where q.id=case when split_part(p_name,'/',2) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then split_part(p_name,'/',2)::uuid end
      and q.company_id=app.permission_company_id() and q.deleted_at is null
      and (
        (q.owner_id=auth.uid() and app.basic_work_allowed('planning') and q.status='planned'
          and q.blocks @> jsonb_build_array(jsonb_build_object('path',p_name)))
        or exists(select 1 from app.material_request_rounds r where r.request_id=q.id
          and r.blocks @> jsonb_build_array(jsonb_build_object('path',p_name))
          and ((q.owner_id=auth.uid() and app.basic_work_allowed('planning'))
            or app.china_work_screen_role()='manager'
            or (app.china_work_screen_role()='worker' and r.assignee_id=auth.uid())))
      ))
$$;
create policy material_request_file_upload on storage.objects for insert to authenticated
with check (bucket_id='material-request-files' and (select app.basic_work_allowed('planning'))
  and split_part(name,'/',1)=(select auth.uid())::text
  and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$');
create policy material_request_file_read on storage.objects for select to authenticated
using (bucket_id='material-request-files' and app.material_file_read(name));

create function app.material_round_json(r app.material_request_rounds, p_detail boolean) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'number',r.round_no,'title',r.title,'brandId',coalesce(r.brand_id::text,''),
    'requestedAt',floor(extract(epoch from r.requested_at)*1000)::bigint,
    'reviewedAt',floor(extract(epoch from r.reviewed_at)*1000)::bigint,
    'assigneeId',r.assignee_id,'assigneeName',(select p.display_name from public.profiles p where p.id=r.assignee_id),
    'assigneeRead',r.confirmed_at is not null,'shippedAt',floor(extract(epoch from r.shipped_at)*1000)::bigint,
    'received',r.received_at is not null,'satisfaction',r.satisfaction))
    || case when p_detail then jsonb_build_object('content',jsonb_build_object(
      'title',r.title,'brandId',coalesce(r.brand_id::text,''),'blocks',r.blocks)) else '{}'::jsonb end
$$;

create function app.read_material_requests(p_scope text,p_id uuid,p_round integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_role text;
  v_result jsonb;
begin
  if v_uid is null or v_company is null then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
  if p_scope='planning' and app.basic_work_allowed('planning') then v_role:='planning';
  elsif p_scope='china' then v_role:=app.china_work_screen_role();
  end if;
  if v_role is null or v_role not in ('planning','manager','worker') then
    raise exception '자재요청을 조회할 권한이 없습니다.' using errcode='42501';
  end if;
  if (p_id is null and p_round is not null)
     or (p_id is not null and ((v_role='planning')=(p_round is not null))) then
    raise exception '조회할 요청과 회차를 확인해 주세요.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(t.data order by t.updated_at desc,t.id),'[]'::jsonb) into v_result from (
    select q.id,q.updated_at,jsonb_build_object(
      'id',q.id,'ownerId',q.owner_id,'ownerName',p.display_name,'revision',q.revision,
      'status',case when v_role<>'planning' or q.status='requested' then '요청중'
        when q.status='completed' then '완료' else '요청예정' end,
      'draftStage',case when v_role='planning' then q.draft_stage end,
      'title',case when v_role='planning' then q.title else '' end,
      'brandId',case when v_role='planning' then coalesce(q.brand_id::text,'') else '' end,
      'blocks',case when p_id is not null and v_role='planning' then
        case when q.status='planned' then q.blocks else coalesce(h.latest_blocks,'[]'::jsonb) end else '[]'::jsonb end,
      'searchText',case when v_role='planning' and q.owner_id=v_uid and p_id is null then
        (select left(string_agg(left(b->>'text',1000),' '),2000)
         from jsonb_array_elements(case when q.status='planned' then q.blocks else coalesce(h.latest_blocks,'[]'::jsonb) end) b
         where b->>'type'='text') end,
      'rounds',coalesce(h.items,'[]'::jsonb)) as data
    from app.material_requests q
    join public.profiles p on p.id=q.owner_id
    left join lateral (
      select jsonb_agg(app.material_round_json(r,p_id is not null) order by r.round_no) items,
        case when v_role='planning' and q.owner_id=v_uid and q.status<>'planned'
          then (select last_r.blocks from app.material_request_rounds last_r where last_r.request_id=q.id order by last_r.round_no desc limit 1) end latest_blocks
      from app.material_request_rounds r
      where r.request_id=q.id and (p_round is null or r.round_no=p_round)
        and (v_role<>'worker' or r.assignee_id=v_uid)
    ) h on true
    where q.company_id=v_company and q.deleted_at is null and (p_id is null or q.id=p_id)
      and ((v_role='planning' and (q.owner_id=v_uid or
        (p_id is null and (q.status='requested' or (q.status='planned' and q.draft_stage='ready')))))
        or (v_role in ('manager','worker') and h.items is not null))
  ) t;
  if p_id is not null and jsonb_array_length(v_result)=0 then
    raise exception '이 요청을 열 수 없거나 배정이 변경되었습니다.' using errcode='42501';
  end if;
  return v_result;
end $$;

create function app.validate_material_draft(p_id uuid,p_title text,p_brand uuid,p_blocks jsonb,p_stage text,p_company uuid)
returns void language plpgsql stable set search_path='' as $$
declare b jsonb;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 or p_stage is null or p_stage not in ('writing','ready')
     or jsonb_typeof(p_blocks) is distinct from 'array' or pg_column_size(p_blocks)>524288 then
    raise exception '제목 또는 요청 내용을 확인해 주세요.' using errcode='22023';
  end if;
  if jsonb_array_length(p_blocks)>80
    or (select count(distinct item.value->>'id') from jsonb_array_elements(p_blocks) as item(value))<>jsonb_array_length(p_blocks)
    or (p_stage='ready' and not exists (
    select 1 from jsonb_array_elements(p_blocks) as item(value) where item.value->>'type' in ('file','image') or btrim(item.value->>'text')<>''
  )) then raise exception '요청 내용을 입력하거나 파일을 첨부해 주세요.' using errcode='22023'; end if;
  if p_brand is not null and not exists(select 1 from public.brands x where x.id=p_brand and x.company_id=p_company) then
    raise exception '같은 회사의 브랜드를 선택해 주세요.' using errcode='42501';
  end if;
  for b in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) is distinct from 'object' or nullif(b->>'id','') is null
      or char_length(b->>'id')>100 or b->>'type' is null or b->>'type' not in ('text','image','file') then
      raise exception '요청 내용 형식이 올바르지 않습니다.' using errcode='22023';
    end if;
    if (b->>'type'='text' and (jsonb_typeof(b->'text') is distinct from 'string'
      or (b ? 'previewHtml' and jsonb_typeof(b->'previewHtml') is distinct from 'string')))
      or (b->>'type'='image' and (jsonb_typeof(b->'caption') is distinct from 'string'
        or jsonb_typeof(b->'widthPercent') is distinct from 'number'
        or jsonb_typeof(b->'offsetY') is distinct from 'number'
        or (b ? 'heightPx' and jsonb_typeof(b->'heightPx') is distinct from 'number')
        or coalesce(b->>'wrap','') not in ('none','left','right'))) then
      raise exception '글자 또는 이미지 배치 형식을 확인해 주세요.' using errcode='22023';
    end if;
    if b->>'type' in ('file','image') and (coalesce(b->>'path','') !~
        ('^'||auth.uid()::text||'/'||p_id::text||'/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      or nullif(btrim(b->>'name'),'') is null or char_length(b->>'name')>255
      or not exists(select 1 from storage.objects o where o.bucket_id='material-request-files' and o.name=b->>'path')) then
      raise exception '저장된 첨부 파일을 확인할 수 없습니다.' using errcode='22023';
    end if;
  end loop;
end $$;

create function app.write_material_request(p_action text,p_id uuid,p_revision integer,p_round integer,p_title text,p_brand uuid,
  p_blocks jsonb,p_stage text,p_assignee uuid,p_score integer) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := app.permission_company_id();
  v_now timestamptz := now();
  q app.material_requests;
  r app.material_request_rounds;
  v_role text;
begin
  if v_uid is null or v_company is null then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
  if p_id is null or p_action is null or p_action not in ('save','delete','send','review','assign','confirm','ship','receive','rate') then
    raise exception '요청 처리 방법을 확인해 주세요.' using errcode='22023';
  end if;
  if p_action in ('save','delete','send','receive','rate') then
    if not coalesce(app.basic_work_allowed('planning'),false) then
      raise exception '자재요청을 변경할 권한이 없습니다.' using errcode='42501'; end if;
    v_role:='planning';
  else
    v_role:=app.china_work_screen_role();
    if v_role is distinct from (case when p_action in ('review','assign') then 'manager' else 'worker' end) then
      raise exception '이 작업을 처리할 권한이 없습니다.' using errcode='42501'; end if;
  end if;
  if p_action='save' and p_revision is null then
    perform app.validate_material_draft(p_id,p_title,p_brand,p_blocks,p_stage,v_company);
    insert into app.material_requests(id,company_id,owner_id,brand_id,title,blocks,draft_stage)
      values(p_id,v_company,v_uid,p_brand,btrim(p_title),p_blocks,p_stage)
      on conflict(id) do nothing;
    if found then return 1; end if;
  end if;
  select x.* into q from app.material_requests x where x.id=p_id and x.company_id=v_company and x.deleted_at is null
    and (v_role<>'planning' or x.owner_id=v_uid)
    and (v_role<>'worker' or exists(select 1 from app.material_request_rounds y where y.request_id=x.id and y.round_no=p_round and y.assignee_id=v_uid))
    and (v_role<>'manager' or exists(select 1 from app.material_request_rounds y where y.request_id=x.id and y.round_no=p_round))
    for update;
  if not found then raise exception '이 요청에 접근할 수 없습니다.' using errcode='42501'; end if;
  if q.revision is distinct from p_revision then
    raise exception '요청이 변경되었습니다. 새로고침 후 다시 확인해 주세요.' using errcode='40001'; end if;
  select y.* into r from app.material_request_rounds y where y.request_id=q.id order by y.round_no desc limit 1;
  if p_action in ('review','assign','confirm','ship','receive','rate') and
     (r.round_no is null or r.round_no is distinct from p_round or q.status<>'requested') then
    raise exception '현재 진행 중인 회차를 확인해 주세요.' using errcode='22023'; end if;

  case p_action
  when 'save' then
    if q.status<>'planned' then raise exception '전송한 회차는 수정할 수 없습니다.' using errcode='22023'; end if;
    perform app.validate_material_draft(p_id,p_title,p_brand,p_blocks,p_stage,v_company);
    update app.material_requests set brand_id=p_brand,title=btrim(p_title),blocks=p_blocks,draft_stage=p_stage where id=q.id;
  when 'delete' then
    if r.round_no is not null then raise exception '전송 이력이 있는 요청은 삭제할 수 없습니다.' using errcode='22023'; end if;
    update app.material_requests set deleted_at=v_now where id=q.id;
  when 'send' then
    if q.status<>'planned' or q.draft_stage is distinct from 'ready' then
      raise exception '작성 완료 후 전송해 주세요.' using errcode='22023'; end if;
    insert into app.material_request_rounds(request_id,round_no,brand_id,title,blocks)
      values(q.id,coalesce(r.round_no,0)+1,q.brand_id,q.title,q.blocks);
    update app.material_requests set status='requested',draft_stage=null,blocks='[]'::jsonb where id=q.id;
  when 'review' then
    if r.shipped_at is not null then raise exception '이미 발송된 회차입니다.' using errcode='22023'; end if;
    if r.reviewed_at is not null then return q.revision; end if;
    update app.material_request_rounds set reviewed_at=v_now,reviewed_by=v_uid where request_id=q.id and round_no=p_round;
  when 'assign' then
    if r.reviewed_at is null or r.shipped_at is not null then
      raise exception '요청 내용을 확인한 진행 중 회차만 배정할 수 있습니다.' using errcode='22023'; end if;
    if not exists(select 1 from public.china_work_assignees a join public.profiles p on p.id=a.profile_id
      join public.departments d on d.id=p.department_id and d.company_id=p.company_id and d.is_active
      where a.company_id=v_company and a.profile_id=p_assignee and p.company_id=v_company and p.status='active'
        and p.department_id=app.work_department('china')) then
      raise exception '목록에 등록된 중국팀 재직 직원을 선택해 주세요.' using errcode='42501'; end if;
    if r.assignee_id=p_assignee then return q.revision; end if;
    update app.material_request_rounds set assignee_id=p_assignee,assigned_by=v_uid,assigned_at=v_now,confirmed_at=null
      where request_id=q.id and round_no=p_round;
  when 'confirm' then
    if r.assignee_id is distinct from v_uid then raise exception '본인 배정만 확인할 수 있습니다.' using errcode='42501'; end if;
    if r.confirmed_at is not null then return q.revision; end if;
    update app.material_request_rounds set confirmed_at=v_now where request_id=q.id and round_no=p_round;
  when 'ship' then
    if r.assignee_id is distinct from v_uid then raise exception '본인 배정만 발송할 수 있습니다.' using errcode='42501'; end if;
    if r.confirmed_at is null then raise exception '요청 내용을 열고 확인을 눌러 주세요.' using errcode='22023'; end if;
    if r.shipped_at is not null then return q.revision; end if;
    update app.material_request_rounds set shipped_at=v_now where request_id=q.id and round_no=p_round;
  when 'receive' then
    if r.shipped_at is null then raise exception '한국으로 발송된 회차만 수령할 수 있습니다.' using errcode='22023'; end if;
    if r.received_at is not null then return q.revision; end if;
    update app.material_request_rounds set received_at=v_now where request_id=q.id and round_no=p_round;
  when 'rate' then
    if r.received_at is null or r.satisfaction is not null or p_score is null or p_score not between 1 and 10 then
      raise exception '수령 확인 후 1~10점의 만족도를 선택해 주세요.' using errcode='22023'; end if;
    update app.material_request_rounds set satisfaction=p_score where request_id=q.id and round_no=p_round;
    update app.material_requests set status=case when p_score=10 then 'completed' else 'planned' end,
      draft_stage=case when p_score<10 then 'not-started' end where id=q.id;
  end case;
  update app.material_requests set revision=q.revision+1,updated_at=v_now where id=q.id;
  return q.revision+1;
end $$;

create function public.read_material_requests(p_scope text,p_id uuid default null,p_round integer default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app.read_material_requests(p_scope,p_id,p_round)
$$;
create function public.write_material_request(p_action text,p_id uuid,p_revision integer default null,p_round integer default null,
  p_title text default null,p_brand uuid default null,p_blocks jsonb default null,p_stage text default null,p_assignee uuid default null,p_score integer default null)
returns integer language sql security invoker set search_path='' as $$
  select app.write_material_request(p_action,p_id,p_revision,p_round,p_title,p_brand,p_blocks,p_stage,p_assignee,p_score)
$$;
revoke all on function app.material_file_read(text),app.material_round_json(app.material_request_rounds,boolean),
  app.validate_material_draft(uuid,text,uuid,jsonb,text,uuid),
  app.read_material_requests(text,uuid,integer),public.read_material_requests(text,uuid,integer),
  app.write_material_request(text,uuid,integer,integer,text,uuid,jsonb,text,uuid,integer),
  public.write_material_request(text,uuid,integer,integer,text,uuid,jsonb,text,uuid,integer) from public,anon,authenticated;
grant execute on function app.material_file_read(text),app.read_material_requests(text,uuid,integer),
  public.read_material_requests(text,uuid,integer),
  app.write_material_request(text,uuid,integer,integer,text,uuid,jsonb,text,uuid,integer),
  public.write_material_request(text,uuid,integer,integer,text,uuid,jsonb,text,uuid,integer) to authenticated;
