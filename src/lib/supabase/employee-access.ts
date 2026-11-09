import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics'

export async function loadEmployeeAccessServer() {
  try {
    return await diagnosticQuery<{ready:boolean;canReview:boolean}>('app', 'access_server_check',
      getSupabase().rpc('review_employee_access', { p_decision: 'check' }))
  } catch (error) {
    const code = ((error as Error)?.cause as {code?:string})?.code
    if (code === 'PGRST202' || code === '42883') return { ready:false, canReview:false }
    throw error
  }
}

/** 승인과 준비된 회사 정보의 연결은 서버의 한 트랜잭션에서 처리한다. */
export async function reviewEmployeeAccess(input: {
  profileId:string; decision:'approve'|'reject'; displayName:string; departmentId:string; position:string; jobGrade:string; hireDate:string
}, context?:DiagnosticContext) {
  return diagnosticQuery<{status:string}>('app', `access_${input.decision}`, getSupabase().rpc('review_employee_access', {
    p_decision:input.decision, p_profile:input.profileId, p_display_name:input.displayName,
    p_department:input.departmentId || null, p_position:input.position || null, p_job_grade:input.jobGrade || null, p_hire_date:input.hireDate || null,
  }), context)
}
