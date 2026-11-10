import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Isolated PostgreSQL for browser verification; no operating DB or real box codes.
export async function createBoxLabelRegistryFixture() {
  const db = await PGlite.create()
  await db.exec(`
    create schema auth; create schema app; create role anon; create role authenticated;
    grant usage on schema auth, app to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000004'::uuid $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable as $$ select true $$;
    create function app.can_edit_brand(uuid) returns boolean language sql stable as $$ select true $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as $$ select false $$;
    create table public.brands(id uuid primary key, company_id uuid not null);
    create table public.profiles(id uuid primary key, company_id uuid not null, status text not null);
    insert into public.brands values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
    insert into public.profiles values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','active');
  `)
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261110062508_warehouse_box_label_registry.sql', import.meta.url), 'utf8'))
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261110062749_warehouse_box_label_lookup_index.sql', import.meta.url), 'utf8'))
  await db.exec('set role authenticated')
  const state = { failNextIssueAfterCommit: false, failHistory: false }
  async function handle(input) {
    const { action, brandId } = input
    if (action === 'issue') {
      const result = (await db.query('select public.issue_warehouse_box_labels($1,$2,$3,$4::text[]) as result', [brandId, input.requestId, input.count, input.codes ?? null])).rows[0].result
      if (state.failNextIssueAfterCommit) { state.failNextIssueAfterCommit = false; throw new Error('network response lost after commit') }
      return result
    }
    if (action === 'list') {
      if (state.failHistory) throw new Error('network history error')
      return (await db.query('select id, created_at, source, label_count from warehouse_box_label_batches where brand_id=$1 order by created_at desc,id desc limit 11 offset $2', [brandId, input.page * 10])).rows
    }
    if (action === 'load') {
      const rows = (await db.query('select code from warehouse_box_labels where brand_id=$1 and batch_id=$2 order by ordinal', [brandId, input.batchId])).rows
      if (!rows.length) throw new Error('발급 번호를 찾지 못했습니다.')
      return rows.map(row => row.code)
    }
    if (action === 'find') {
      const rows = (await db.query('select code from warehouse_box_labels where brand_id=$1 and code=$2', [brandId, input.code])).rows
      if (!rows.length) throw new Error('등록된 번호가 없습니다.')
      return rows[0].code
    }
    throw new Error('unknown fixture action')
  }
  return { db, state, handle }
}
