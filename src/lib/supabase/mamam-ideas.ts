import { getSupabase } from '@/lib/supabase/client'

const MAMAM_IMAGE_BUCKET = 'mamam-idea-images'
const SIGNED_IMAGE_SECONDS = 30 * 60

type MamamIdeaSubmissionRow = {
  id: string
  submitter_name: string
  department: string
  description: string
  image_paths: string[]
  created_at: string
  submitted_at: string
}

export type MamamIdeaSubmission = {
  id: string
  submitterName: string
  department: string
  description: string
  imagePaths: string[]
  createdAt: string
  submittedAt: string
}

export type MamamIdeaImage = {
  path: string
  signedUrl: string
}

export class MamamIdeaStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MamamIdeaStoreError'
  }
}

function fail(message: string, context: Record<string, unknown>): never {
  console.warn('[mamam-inbox] 접수함 조회 실패', context)
  throw new MamamIdeaStoreError(message)
}

export async function listMamamIdeaSubmissions(): Promise<
  MamamIdeaSubmission[]
> {
  const { data, error } = await getSupabase()
    .from('mamam_idea_submissions')
    .select(
      'id, submitter_name, department, description, image_paths, created_at, submitted_at',
    )
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })

  if (error) {
    fail('아이디어 접수 목록을 불러오지 못했습니다.', {
      operation: 'list',
      message: error.message,
      code: error.code,
    })
  }

  return ((data ?? []) as MamamIdeaSubmissionRow[]).map((row) => ({
    id: row.id,
    submitterName: row.submitter_name,
    department: row.department,
    description: row.description,
    imagePaths: row.image_paths ?? [],
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  }))
}

export async function getMamamIdeaImageUrls(
  paths: readonly string[],
): Promise<MamamIdeaImage[]> {
  const uniquePaths = [...new Set(paths.filter(Boolean))]
  return Promise.all(
    uniquePaths.map(async (path) => {
      const { data, error } = await getSupabase()
        .storage.from(MAMAM_IMAGE_BUCKET)
        .createSignedUrl(path, SIGNED_IMAGE_SECONDS)

      if (error || !data?.signedUrl) {
        fail('첨부 이미지를 불러오지 못했습니다.', {
          operation: 'signed-url',
          path,
          message: error?.message ?? 'signed URL missing',
        })
      }

      return { path, signedUrl: data.signedUrl }
    }),
  )
}
