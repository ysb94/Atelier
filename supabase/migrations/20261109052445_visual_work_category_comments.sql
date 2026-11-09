-- A Visual discussion belongs to a saved category, independent of its current assignee.
create table app.visual_work_category_comments (
  id uuid primary key,
  request_id uuid not null references public.work_requests(id) on delete cascade,
  category_id text not null check (category_id ~ '^[a-zA-Z0-9_-]{1,64}$' and category_id <> 'main'),
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  author_department text not null default '',
  reply_to uuid,
  body text not null check (length(body) <= 10000),
  files jsonb not null default '[]',
  published_at timestamptz,
  unique (request_id, category_id, id),
  foreign key (request_id, category_id, reply_to)
    references app.visual_work_category_comments(request_id, category_id, id)
);
create index visual_work_category_comment_threads
  on app.visual_work_category_comments(request_id, category_id, published_at, id)
  where published_at is not null;
alter table app.visual_work_category_comments enable row level security;
revoke all on app.visual_work_category_comments from public, anon, authenticated;

create function app.visual_work_category_exists(p_data jsonb, p_category text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_category ~ '^[a-zA-Z0-9_-]{1,64}$' and p_category <> 'main' and (
    jsonb_path_exists(p_data, '$.values.visualRequest.categories[*] ? (@.id == $id)', jsonb_build_object('id',p_category), true)
    or jsonb_path_exists(p_data, '$.categoryAssignments[*] ? (@.categoryId == $id)', jsonb_build_object('id',p_category), true)
    or jsonb_path_exists(p_data, '$.values.blocks[*] ? (@.type == "text" && @.id == $marker)',
      jsonb_build_object('marker','visual-request-section:' || p_category), true)
  ), false)
$$;

create function app.visual_work_category_discussion_allowed(p_request uuid, p_category text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.work_requests r
    join public.profiles me on me.id = auth.uid() and me.company_id = r.company_id and me.status = 'active'
    where r.id = p_request and r.owner = 'design' and r.status <> 'draft'
      and coalesce(r.data->>'deleted','false') <> 'true'
      and app.visual_work_category_exists(r.data,p_category)
      and (r.requester_id = me.id or app.work_manage_allowed(r.owner)
        or jsonb_path_exists(r.data, '$.categoryAssignments[*] ? (@.categoryId == $category && @.assigneeId == $employee)',
          jsonb_build_object('category',p_category,'employee',me.id::text), true))
  )
$$;

create function app.list_visual_work_category_comments(p_request uuid, p_category text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.visual_work_category_discussion_allowed(p_request,p_category) then
    raise exception '이 분류의 댓글을 조회할 권한이 없습니다.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canWrite', (select r.status not in ('cancelled','rejected') from public.work_requests r where r.id=p_request),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'authorId', c.author_id, 'authorName', c.author_name,
        'authorDepartment', c.author_department, 'replyTo', c.reply_to,
        'body', c.body, 'files', c.files, 'createdAt', c.published_at
      ) order by c.published_at, c.id)
      from app.visual_work_category_comments c
      where c.request_id=p_request and c.category_id=p_category and c.published_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- Reserve deterministic paths, then publish only when each private Storage upload is present.
-- Replays of the same command return the existing reservation or published comment.
create function app.save_visual_work_category_comment(
  p_request uuid, p_category text, p_id uuid, p_body text, p_reply_to uuid, p_files jsonb, p_publish boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  request public.work_requests%rowtype;
  comment app.visual_work_category_comments%rowtype;
  manifest jsonb := '[]';
  item jsonb;
  file_index integer := 0;
  content text := btrim(coalesce(p_body,''));
begin
  select * into request from public.work_requests where id=p_request for share;
  if not found or not app.visual_work_category_discussion_allowed(p_request,p_category) then
    raise exception '이 분류에 댓글을 쓸 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_id is null or p_publish is null or jsonb_typeof(p_files) is distinct from 'array' or length(content)>10000 then
    raise exception '댓글 입력을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files)>5 or (content='' and jsonb_array_length(p_files)=0) then
    raise exception '내용 또는 첨부파일을 확인해 주세요.' using errcode = '22023';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from app.visual_work_category_comments parent
    where parent.request_id=p_request and parent.category_id=p_category and parent.id=p_reply_to
      and parent.reply_to is null and parent.published_at is not null
  ) then
    raise exception '같은 분류의 댓글에만 답글을 쓸 수 있습니다.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_files)
  loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'name'),0) not between 1 and 255
      or item->>'name' ~ '[[:cntrl:]/\\]'
      or item->>'name' ~* '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$'
      or coalesce(item->>'type','') !~ '^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$'
      or length(item->>'type')>150
      or coalesce(item->>'size','') !~ '^[0-9]{1,8}$'
    then
      raise exception '첨부파일 형식을 확인해 주세요.' using errcode = '22023';
    end if;
    if (item->>'size')::integer not between 1 and 20971520 then
      raise exception '첨부파일은 한 개당 20MB까지 올릴 수 있습니다.' using errcode = '22023';
    end if;
    file_index := file_index + 1;
    manifest := manifest || jsonb_build_array(jsonb_build_object(
      'name',item->>'name', 'type',item->>'type', 'size',(item->>'size')::integer,
      'path','visual-comments/' || request.company_id || '/' || p_request || '/' || p_id || '/' || file_index
    ));
  end loop;

  if request.status in ('cancelled','rejected') and not exists (
    select 1 from app.visual_work_category_comments c
    where c.id=p_id and c.author_id=auth.uid() and c.request_id=p_request
      and c.category_id=p_category and c.published_at is not null
  ) then
    raise exception '종료된 업무에는 댓글을 쓸 수 없습니다.' using errcode = '42501';
  end if;

  insert into app.visual_work_category_comments(
    id, request_id, category_id, author_id, author_name, author_department, reply_to, body, files
  )
  select p_id,p_request,p_category,me.id,coalesce(me.display_name,'직원'),coalesce(d.name,''),p_reply_to,content,manifest
  from public.profiles me left join public.departments d on d.id=me.department_id and d.company_id=me.company_id
  where me.id=auth.uid()
  on conflict (id) do nothing;

  select * into comment from app.visual_work_category_comments where id=p_id for update;
  if not found or comment.author_id is distinct from auth.uid()
    or comment.request_id is distinct from p_request or comment.category_id is distinct from p_category
    or comment.reply_to is distinct from p_reply_to or comment.body is distinct from content or comment.files is distinct from manifest
  then
    raise exception '같은 전송 번호로 다른 댓글을 저장할 수 없습니다.' using errcode = '40001';
  end if;

  if comment.published_at is null and (p_publish or file_index=0) then
    if exists (
      select 1 from jsonb_array_elements(manifest) f
      where not exists (
        select 1 from storage.objects o where o.bucket_id='company-work-requests' and o.name=f->>'path'
          and o.metadata->>'size'=f->>'size'
      )
    ) then
      raise exception '업로드가 끝난 첨부파일을 확인해 주세요.' using errcode = '22023';
    end if;
    update app.visual_work_category_comments set published_at=clock_timestamp()
    where id=p_id returning * into comment;
  end if;

  return jsonb_build_object('published',comment.published_at is not null,'files',coalesce((
    select jsonb_agg(f || jsonb_build_object('uploaded', exists (
      select 1 from storage.objects o where o.bucket_id='company-work-requests' and o.name=f->>'path'
        and o.metadata->>'size'=f->>'size'
    )) order by ord)
    from jsonb_array_elements(comment.files) with ordinality t(f,ord)
  ),'[]'::jsonb));
end;
$$;

create function app.visual_work_comment_object_allowed(p_path text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.visual_work_category_comments c
    join public.work_requests r on r.id=c.request_id
    join public.profiles me on me.id=auth.uid() and me.company_id=r.company_id and me.status='active'
    where c.id=case when split_part(p_path,'/',4) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then split_part(p_path,'/',4)::uuid end
      and p_path like 'visual-comments/%'
      and c.files @> jsonb_build_array(jsonb_build_object('path',p_path))
      and case p_action
        when 'upload' then c.published_at is null and c.author_id=me.id and r.status not in ('cancelled','rejected')
          and app.visual_work_category_discussion_allowed(c.request_id,c.category_id)
        when 'read' then
          (c.published_at is not null and app.visual_work_category_discussion_allowed(c.request_id,c.category_id))
          or (c.published_at is null and c.author_id=me.id)
          or (r.requester_id=me.id and r.data->>'deleted'='true')
        when 'remove' then (c.published_at is null and c.author_id=me.id)
          or (r.requester_id=me.id and r.data->>'deleted'='true')
        else false
      end
  )
$$;

-- Serialize Storage writes with publication and request deletion in the same lock order.
create function app.visual_work_comment_storage_write_allowed(p_path text, p_action text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  comment_id uuid;
  request_id uuid;
begin
  if p_action not in ('upload','remove') or not app.visual_work_comment_object_allowed(p_path,p_action) then
    return false;
  end if;
  comment_id := split_part(p_path,'/',4)::uuid;
  select c.request_id into request_id from app.visual_work_category_comments c where c.id=comment_id;
  if not found then return false; end if;
  perform 1 from public.work_requests r where r.id=request_id for share;
  if not found then return false; end if;
  perform 1 from app.visual_work_category_comments c where c.id=comment_id for share;
  if not found then return false; end if;
  return app.visual_work_comment_object_allowed(p_path,p_action);
end;
$$;

create policy visual_work_comment_object_insert on storage.objects for insert to authenticated
  with check (bucket_id='company-work-requests' and app.visual_work_comment_storage_write_allowed(name,'upload'));
create policy visual_work_comment_object_read on storage.objects for select to authenticated
  using (bucket_id='company-work-requests' and app.visual_work_comment_object_allowed(name,'read'));
create policy visual_work_comment_object_delete on storage.objects for delete to authenticated
  using (bucket_id='company-work-requests' and app.visual_work_comment_storage_write_allowed(name,'remove'));

-- Include new private attachments in the existing request deletion and cleanup retry paths.
create function app.visual_work_comment_file_paths(p_request uuid) returns setof text
language sql stable set search_path = '' as $$
  select f->>'path'
  from app.visual_work_category_comments c cross join lateral jsonb_array_elements(c.files) f
  where c.request_id=p_request
$$;

create or replace function app.delete_work_request(p_id uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.work_requests%rowtype;
  paths jsonb;
begin
  select * into r from public.work_requests where id=p_id for update;
  if not found or not app.work_request_read(p_id) or r.requester_id<>auth.uid()
    or (r.status not in ('draft','requested') and coalesce(r.data->>'deleted','false')<>'true')
  then
    raise exception '접수 전 본인 요청만 삭제할 수 있습니다.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(path),'[]') into paths from (
    select f.storage_path path from public.work_request_files f where f.request_id=p_id
    union all select app.visual_work_comment_file_paths(p_id)
  ) files;
  if r.data->>'deleted'='true' then return paths; end if;
  if r.revision<>p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;

  if jsonb_array_length(paths)>0 then
    update public.work_requests set status='cancelled',data=data||'{"deleted":true}',revision=revision+1,updated_at=clock_timestamp() where id=p_id;
  else
    delete from public.work_requests where id=p_id;
  end if;
  return paths;
end;
$$;

create or replace function app.finish_work_request_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.work_requests r
  where r.id=p_id and r.requester_id=auth.uid() and r.data->>'deleted'='true'
    and not exists (
      select 1 from public.work_request_files f join storage.objects o
        on o.bucket_id='company-work-requests' and o.name=f.storage_path where f.request_id=r.id
    )
    and not exists (
      select 1 from app.visual_work_comment_file_paths(r.id) p(path)
      join storage.objects o on o.bucket_id='company-work-requests' and o.name=p.path
    );
end;
$$;

create function app.visual_work_comment_deleted_files(p_owner text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f->>'path','requestId',r.id,'path',f->>'path','name',f->>'name',
    'type',f->>'type','size',f->'size','deleted',true
  )), '[]'::jsonb)
  from public.work_requests r
  join public.profiles me on me.id=auth.uid() and me.status='active' and me.company_id=r.company_id and me.id=r.requester_id
  join app.visual_work_category_comments c on c.request_id=r.id
  cross join lateral jsonb_array_elements(c.files) f
  where r.owner='design' and (p_owner is null or p_owner=r.owner) and r.data->>'deleted'='true'
$$;

create or replace function public.list_work_requests(p_owner text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select s.snapshot || jsonb_build_object('files',
    coalesce(s.snapshot->'files','[]'::jsonb) || app.visual_work_comment_deleted_files(p_owner))
  from (select app.list_work_requests(p_owner) snapshot) s
$$;

create function public.list_visual_work_category_comments(p_request uuid, p_category text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select app.list_visual_work_category_comments(p_request,p_category)
$$;
create function public.save_visual_work_category_comment(
  p_request uuid, p_category text, p_id uuid, p_body text, p_reply_to uuid, p_files jsonb, p_publish boolean
) returns jsonb language sql security invoker set search_path = '' as $$
  select app.save_visual_work_category_comment(p_request,p_category,p_id,p_body,p_reply_to,p_files,p_publish)
$$;

revoke all on function app.visual_work_category_exists(jsonb,text),
  app.visual_work_category_discussion_allowed(uuid,text), app.visual_work_comment_file_paths(uuid),
  app.visual_work_comment_object_allowed(text,text), app.visual_work_comment_storage_write_allowed(text,text),
  app.visual_work_comment_deleted_files(text),
  app.list_visual_work_category_comments(uuid,text), app.save_visual_work_category_comment(uuid,text,uuid,text,uuid,jsonb,boolean),
  public.list_visual_work_category_comments(uuid,text), public.save_visual_work_category_comment(uuid,text,uuid,text,uuid,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function app.visual_work_comment_object_allowed(text,text), app.visual_work_comment_storage_write_allowed(text,text),
  app.visual_work_comment_deleted_files(text),
  app.list_visual_work_category_comments(uuid,text), app.save_visual_work_category_comment(uuid,text,uuid,text,uuid,jsonb,boolean),
  public.list_visual_work_category_comments(uuid,text), public.save_visual_work_category_comment(uuid,text,uuid,text,uuid,jsonb,boolean)
  to authenticated;

notify pgrst, 'reload schema';
