begin;

-- Browser uploads and the private bucket use the same decimal 10 GB capacity.
update storage.buckets
set file_size_limit = 10000000000
where id = 'sample-work-orders';

create or replace function app.sample_pack_validate(p app.sample_work_order_packs, p_files jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare
  f jsonb;
  size_total bigint := 0;
  f_size bigint;
begin
  if jsonb_typeof(p_files) is distinct from 'array' then return false; end if;
  if (select count(distinct x->>'path') from jsonb_array_elements(p_files) x) <> jsonb_array_length(p_files) then
    return false;
  end if;
  for f in select value from jsonb_array_elements(p_files) loop
    if length(btrim(coalesce(f->>'name',''))) = 0 or length(f->>'name') > 205
      or f->>'name' ~ '[[:cntrl:]]' then return false; end if;
    if coalesce(f->>'size','') !~ '^[1-9][0-9]{0,10}$' or coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' then
      return false;
    end if;
    f_size := (f->>'size')::bigint;
    size_total := size_total + f_size;
    if size_total > 10000000000 then return false; end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='sample-work-orders'
        and o.name=f->>'path' and o.metadata->>'size'=f_size::text) then return false; end if;
    if split_part(f->>'path','/',1) is distinct from p.id::text and not exists(
        select 1 from app.sample_work_order_packs source where source.draft_id=p.draft_id
          and source.published_at is not null and source.files @> jsonb_build_array(f)
      ) then return false; end if;
  end loop;
  return true;
end
$$;

commit;
