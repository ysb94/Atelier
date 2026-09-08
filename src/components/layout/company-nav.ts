import {
  ownerFromDepartment,
  WORK_REQUEST_OWNERS,
  type WorkRequestOwner,
} from '@/features/work-requests/work-request-form-config'

export function primaryWorkOwner(input: {
  departmentName?: string | null
  capabilities?: string[]
}): WorkRequestOwner {
  const fromCapability = input.capabilities?.find((value): value is WorkRequestOwner =>
    (WORK_REQUEST_OWNERS as readonly string[]).includes(value),
  )
  if (fromCapability) return fromCapability
  return ownerFromDepartment(input.departmentName) ?? 'planning'
}
