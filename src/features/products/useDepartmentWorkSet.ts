import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FieldOwner } from '@/lib/types'
import {
  loadDepartmentWorkSet,
  loadDepartmentWorkSets,
  mergeStyleIds,
  saveDepartmentWorkSet,
} from '@/lib/products/department-work-set'

export function useDepartmentWorkSet(
  userId: string | null | undefined,
  brandIds: string | readonly string[],
  owner: FieldOwner | undefined,
) {
  const storageUser = userId || 'local'
  const brandsKey = (Array.isArray(brandIds) ? brandIds : [brandIds])
    .filter(Boolean)
    .join(',')
  const brands = useMemo(
    () => brandsKey.split(',').filter(Boolean),
    [brandsKey],
  )
  const [ids, setIds] = useState<string[]>(() =>
    owner ? loadDepartmentWorkSets(storageUser, brands, owner) : [],
  )

  useEffect(() => {
    if (!owner) {
      setIds([])
      return
    }
    setIds(loadDepartmentWorkSets(storageUser, brands, owner))
  }, [brands, brandsKey, owner, storageUser])

  const add = useCallback(
    (
      styleIds: readonly string[],
      brandIdByStyleId?: ReadonlyMap<string, string>,
    ) => {
      if (!owner) return
      const grouped = new Map<string, string[]>()
      for (const id of styleIds) {
        const brandId = brandIdByStyleId?.get(id) ?? brands[0]
        if (!brandId) continue
        const list = grouped.get(brandId) ?? []
        list.push(id)
        grouped.set(brandId, list)
      }
      let nextAll = ids
      for (const [brandId, added] of grouped) {
        const current = loadDepartmentWorkSet(storageUser, brandId, owner)
        saveDepartmentWorkSet(
          storageUser,
          brandId,
          owner,
          mergeStyleIds(current, added),
        )
        nextAll = mergeStyleIds(nextAll, added)
      }
      setIds(nextAll)
    },
    [brands, ids, owner, storageUser],
  )

  const remove = useCallback(
    (styleId: string, brandId?: string) => {
      if (!owner) return
      const target = brandId ?? brands[0]
      if (target) {
        const current = loadDepartmentWorkSet(storageUser, target, owner)
        saveDepartmentWorkSet(
          storageUser,
          target,
          owner,
          current.filter((id) => id !== styleId),
        )
      }
      setIds((current) => current.filter((id) => id !== styleId))
    },
    [brands, owner, storageUser],
  )

  const clear = useCallback(() => {
    if (!owner) return
    for (const brandId of brands) {
      saveDepartmentWorkSet(storageUser, brandId, owner, [])
    }
    setIds([])
  }, [brands, owner, storageUser])

  const idSet = useMemo(() => new Set(ids), [ids])

  return { ids, idSet, add, remove, clear }
}
