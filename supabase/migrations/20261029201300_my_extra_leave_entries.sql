create function app.my_extra_leave_entries()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = actor and status = 'active') then
    raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id,
      'days', g.days,
      'expires', g.expires_on,
      'note', g.note,
      'created', g.granted_on,
      'used', coalesce(u.used, 0)
    ) order by g.expires_on, g.created_at, g.id)
    from app.employee_extra_leave g
    left join lateral (
      select sum(days) as used from app.employee_extra_leave_usage
      where grant_id = g.id and refunded_at is null
    ) u on true
    where g.employee_id = actor and g.deleted_at is null
  ), '[]'::jsonb);
end;
$$;
revoke all on function app.my_extra_leave_entries() from public, anon;
grant execute on function app.my_extra_leave_entries() to authenticated;

create function public.my_extra_leave_entries()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.my_extra_leave_entries();
$$;
revoke all on function public.my_extra_leave_entries() from public, anon;
grant execute on function public.my_extra_leave_entries() to authenticated;
