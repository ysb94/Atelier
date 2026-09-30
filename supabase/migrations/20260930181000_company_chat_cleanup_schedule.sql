-- 한국시간 새벽 4시는 UTC 19시다. pg_cron은 UTC로 돈다.
-- 호출에는 비밀키가 필요 없다. 함수는 기한이 지난 파일만 지운다.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $unschedule$
declare
  v_job bigint;
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'chat-files-cleanup'
  ) then
    select jobid
    into v_job
    from cron.job
    where jobname = 'chat-files-cleanup';
    perform cron.unschedule(v_job);
  end if;
end;
$unschedule$;

select cron.schedule(
  'chat-files-cleanup',
  '0 19 * * *',
  $$
  select net.http_post(
    url := 'https://pmzgdqvtzwfwqmvhzcyo.supabase.co/functions/v1/chat-files-cleanup',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
