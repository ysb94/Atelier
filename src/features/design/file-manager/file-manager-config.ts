export const UPLOAD_WORKER_BASE =
  'https://r2-worker.masmarulez-upload.workers.dev'
export const DEFAULT_LIST_WORKER_BASE =
  'https://r2-worker.masmarulez-upload.workers.dev'
export const LIST_WORKER_STORAGE_KEY = 'masmarulezListWorkerBase'
export const CDN_BASE = 'https://cdn2.auchee.com'
export const ROOT_FOLDER = '루트 파일'
export const R2_BRAND_ROOT = 'masmarulez'
export const DEFAULT_BROWSE_TYPES = ['embed', 'image', 'spin360', 'video']
export const HIDDEN_BROWSE_TYPES = new Set(['logs'])
export const GRID_BATCH_SIZE = 60
export const MARQUEE_THRESHOLD = 5
export const PREVIEW_WIDTH_KEY = 'masmarulezPreviewWidth'
export const PREVIEW_MIN_WIDTH = 280
export const PREVIEW_MAX_WIDTH = 900
export const TAG_PANEL_HEIGHT_KEY = 'masmarulezTagPanelHeight'
export const TAG_PANEL_MIN_HEIGHT = 80
export const TAG_PANEL_MAX_HEIGHT = 480
export const GRID_SORT_KEY = 'masmarulezGridSort'
export const GRID_VIEW_KEY = 'masmarulezGridView'
export const GLOBAL_SEARCH_KEY = 'masmarulezGlobalSearch'

export const VIDEO_UPLOAD_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v'])

export const FILE_TYPE_ICON_META = {
  mp4: { icon: '🎬', title: '동영상' },
  webm: { icon: '🎬', title: '동영상' },
  mov: { icon: '🎬', title: '동영상' },
  m4v: { icon: '🎬', title: '동영상' },
  gif: { icon: '🎞️', title: 'GIF' },
  jpg: { icon: '🖼️', title: '이미지' },
  jpeg: { icon: '🖼️', title: '이미지' },
  png: { icon: '🖼️', title: '이미지' },
  webp: { icon: '🖼️', title: '이미지' },
  avif: { icon: '🖼️', title: '이미지' },
  svg: { icon: '🖼️', title: '이미지' },
  html: { icon: '📄', title: 'HTML' },
  htm: { icon: '📄', title: 'HTML' },
  zip: { icon: '🗜️', title: '압축 파일' },
  rar: { icon: '🗜️', title: '압축 파일' },
  '7z': { icon: '🗜️', title: '압축 파일' },
  pdf: { icon: '📕', title: 'PDF' },
} as const

export const DEFAULT_FILE_ICON_META = { icon: '📎', title: '파일' } as const
