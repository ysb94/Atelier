-- 같은 업체에 줄이 둘 이상인데 대표 줄만 지점명 칸이 비어 있던 데이터를 채운다.
-- 지점명이 이름 칸에만 있어서 업체·지점 표시명을 화면마다 다르게 만들었다.
update public.code_usage_targets t
set site_name = btrim(t.name),
    normalized_site_name = regexp_replace(
      lower(btrim(t.name)), '[^0-9a-z가-힣]', '', 'g'
    )
where t.group_id is not null
  and coalesce(btrim(t.site_name), '') = ''
  and exists (
    select 1
    from public.code_usage_targets s
    where s.group_id = t.group_id
      and s.id <> t.id
  );
