// This capability permits local, NEW migration source files only. It does not
// authorize any SQL execution, production data access or existing SQL edits.
export const DB_APPROVAL_ID = 'atelier-20261015-preserve-existing-data-db-consent-v1'
export const isMigrationDraft = file => /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(file)
export function migrationDraftsApproved(config, task) {
  const policy=config.v2?.migrationDrafts
  return policy?.enabled===true&&policy.approvalId===DB_APPROVAL_ID
    &&String(task.source?.answer??'').includes(`공통 승인 식별: ${DB_APPROVAL_ID}`)
}
