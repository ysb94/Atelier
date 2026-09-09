import type { UseQueryResult } from '@tanstack/react-query'

/**
 * 브랜드별 목록 쿼리 묶음(`useQueries`)을 구조 공유되는 한 객체로 합친다.
 *
 * `useQueries` 의 기본 반환 배열은 매 렌더 새 참조다. 그대로 useMemo 의존성에 넣으면
 * 카탈로그 합치기·정렬이 매 렌더 다시 돌고, react-table 의 자동 페이지 초기화와
 * 맞물리면 오류 없는 무한 렌더 루프가 된다. `combine` 결과는 내용이 같으면 참조가
 * 유지되므로 아래 형태로 넘긴다.
 *
 *   useQueries({ queries, combine: combineListQueries<Season> })
 */
export type ListQueries<T> = {
  /** 쿼리 순서대로의 data. 아직 없으면 undefined. */
  data: (T[] | undefined)[]
  loading: boolean
  errorIndexes: number[]
}

export function combineListQueries<T>(
  results: UseQueryResult<T[]>[],
): ListQueries<T> {
  return {
    data: results.map((result) => result.data),
    loading: results.some((result) => result.isLoading),
    errorIndexes: results.flatMap((result, index) =>
      result.isError ? [index] : [],
    ),
  }
}

export function flattenListQueries<T>(queries: ListQueries<T>): T[] {
  return queries.data.flatMap((rows) => rows ?? [])
}
