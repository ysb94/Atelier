-- 앱 normalizeInvoiceText와 AI 검색 키를 맞추고, 품목명 AI 후보 기본을 16개로 올린다.
-- 업무 원장 normalized_* 열은 앱이 쓰므로 여기서 다시 쓰지 않는다.

create or replace function app.normalize_invoice_lookup_key(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(
    lower(
      regexp_replace(
        btrim(
          regexp_replace(
            translate(
              regexp_replace(
                normalize(coalesce(p_text, ''), nfkc),
                U&'[\200B-\200D\FEFF\00AD]',
                '',
                'g'
              ),
              U&'\00A0\FF3B\005B\FF3D\005D\2010\2011\2012\2013\2014\2015',
              ' [[]]-----'
            ),
            '\s+',
            ' ',
            'g'
          )
        ),
        '\]\s+',
        ']',
        'g'
      )
    ),
    200
  );
$$;

comment on function app.normalize_invoice_lookup_key(text) is
  '송장 조회 키 비교용. 앱 normalizeInvoiceText와 같고 검색은 200자로 자른다.';

revoke all on function app.normalize_invoice_lookup_key(text) from public;
grant execute on function app.normalize_invoice_lookup_key(text) to authenticated;

update public.ai_recommendation_feedback
set normalized_lookup_key = app.normalize_invoice_lookup_key(lookup_key)
where normalized_lookup_key is distinct from app.normalize_invoice_lookup_key(lookup_key);

update public.ai_item_name_recommendation_feedback
set
  normalized_item_name = app.normalize_invoice_lookup_key(item_name),
  normalized_product_lookup_key = app.normalize_invoice_lookup_key(product_lookup_key)
where
  normalized_item_name is distinct from app.normalize_invoice_lookup_key(item_name)
  or normalized_product_lookup_key is distinct from
    app.normalize_invoice_lookup_key(product_lookup_key);

alter table public.ai_feature_routes
  alter column decision_config set default
    '{"high":0.72,"margin":0.10,"low":0.40,"aiTopN":16}'::jsonb;

comment on column public.ai_feature_routes.decision_config is
  'hybrid_auto 임계값. high/margin/low와 품목명 AI 후보 수 aiTopN(기본 16, 최대 16).';

update public.ai_feature_routes
set decision_config = jsonb_set(
  coalesce(decision_config, '{}'::jsonb),
  '{aiTopN}',
  '16'::jsonb
)
where feature_key = 'invoice_product_recommendation'
  and coalesce(decision_config->>'aiTopN', '6') = '6';

do $$
declare
  v_got text;
begin
  v_got := app.normalize_invoice_lookup_key(
    U&'마스마룰즈\00A0\FF3BSET\FF3D 로고\2014패치'
  );
  if v_got is distinct from '마스마룰즈 [set]로고-패치' then
    raise exception 'normalize fixture fullwidth/nbsp/dash: %', v_got;
  end if;

  v_got := app.normalize_invoice_lookup_key(U&'로고\200B패치 볼캡');
  if v_got is distinct from '로고패치 볼캡' then
    raise exception 'normalize fixture zwsp: %', v_got;
  end if;

  v_got := app.normalize_invoice_lookup_key(U&'크림\2013레몬 / 네이비');
  if v_got is distinct from '크림-레몬 / 네이비' then
    raise exception 'normalize fixture hyphen: %', v_got;
  end if;

  v_got := app.normalize_invoice_lookup_key('  Color:  Cream   lemon  ');
  if v_got is distinct from 'color: cream lemon' then
    raise exception 'normalize fixture spaces: %', v_got;
  end if;

  if app.normalize_invoice_lookup_key('') is distinct from '' then
    raise exception 'normalize fixture empty';
  end if;
end
$$;
