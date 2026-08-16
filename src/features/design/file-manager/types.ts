export interface ServerFileItem {
  key?: string
  name?: string
  displayName?: string
  relativePath?: string
  size?: number
  uploaded?: string
  [key: string]: unknown
}

export interface FolderGroup {
  folder: string
  items: ServerFileItem[]
}

export type SelectionEntry =
  | { kind: 'file'; item: ServerFileItem; type: string }
  | { kind: 'folder'; folder: string; type: string }
  | { kind: 'browse'; browseType: string }

export interface PreviewSelection {
  item: ServerFileItem
  type: string
}

export interface AccumulatedTag {
  uid: number
  item: ServerFileItem
  type: string
  url: string
  tag: string
}

export interface UploadQueueItem {
  id: string
  file: File
  targetPath: string
  status: 'pending' | 'uploading' | 'completed' | 'failed'
}

export type GridSortMode = 'name' | 'name-desc' | 'date' | 'date-desc'
export type GridViewMode = 'normal' | 'large' | 'list'

export interface HistoryLogEntry {
  action: string
  path?: string
  from?: string
  to?: string
  count?: number
  ts?: string
  [key: string]: unknown
}

export interface UiDialogConfig {
  mode: 'alert' | 'confirm' | 'prompt'
  message: string
  title?: string
  okText?: string
  cancelText?: string
  defaultValue?: string
  danger?: boolean
}

export interface ContextMenuItem {
  label: string
  action: () => void | Promise<void>
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export interface LogSentencePart {
  kind: 'text' | 'quote'
  value: string
}

export interface FormattedLogSentence {
  type: string
  parts: LogSentencePart[]
}

export interface UploadConflictResult<T extends { targetPath: string; file: File }> {
  fileDuplicates: T[]
  embedDuplicates: T[]
  duplicateKeys: Set<string>
}
