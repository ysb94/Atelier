type PageError = { code?: string; message: string }

/** 모든 페이지를 읽거나 오류를 반환한다. 실패한 조회의 부분 합계는 사용하지 않는다. */
export async function fetchAttendancePages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PageError | null }>): Promise<{ rows: T[]; error: PageError | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await read(offset, offset + 499)
    if (result.error) return { rows: [], error: result.error }
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < 500) return { rows, error: null }
  }
}
