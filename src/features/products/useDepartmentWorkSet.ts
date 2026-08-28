import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FieldOwner } from '@/lib/types'
import {
  loadDepartmentWorkSet,
  mergeStyleIds,
  saveDepartmentWorkSet,
} from '@/lib/products/department-work-set'

export function useDepartmentWorkSet(
  userId: string | null | undefined,
  brandId: string,
  owner: FieldOwner | undefined,
) {
  const storageUser = userId || 'local'
  const [ids, setIds] = useState<string[]>(() =>
    owner ? loadDepartmentWorkSet(storageUser, brandId, owner) : [],
  )

  useEffect(() => {
    if (!owner) {
      setIds([])
      return
    }
    setIds(loadDepartmentWorkSet(storageUser, brandId, owner))
  }, [brandId, owner, storageUser])

  const persist = useCallback(
    (next: string[]) => {
      if (!owner) return
      saveDepartmentWorkSet(storageUser, brandId, owner, next)
      setIds(next)
    },
    [brandId, owner, storageUser],
  )

  const add = useCallback(
    (styleIds: readonly string[]) => {
      persist(mergeStyleIds(ids, styleIds))
    },
    [ids, persist],
  )

  const remove = useCallback(
    (styleId: string) => {
      persist(ids.filter((id) => id !== styleId))
    },
    [ids, persist],
  )

  const clear = useCallback(() => persist([]), [persist])

  const idSet = useMemo(() => new Set(ids), [ids])

  return { ids, idSet, add, remove, clear }
}
