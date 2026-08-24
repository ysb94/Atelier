-- 균등 랜덤 RPC는 SECURITY INVOKER라 내부 해시 함수를 authenticated가
-- 직접 실행해야 한다. public·anon은 계속 막는다.

revoke execute on function app.fnv1a_32_utf8(text) from public, anon;
grant execute on function app.fnv1a_32_utf8(text) to authenticated;
