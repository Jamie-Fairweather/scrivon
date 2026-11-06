import type { TextDecodeIssue, TextFileFormat } from '@/lib/workspace/text-encoding'

export type FileNode =
    | {
          kind: 'directory'
          name: string
          path: string
          children: FileNode[]
          /** The folder couldn't be listed (no permission, or gone while reading), so `children` is empty. */
          unreadable?: true
      }
    | {
          kind: 'file'
          name: string
          path: string
      }

export type DocumentTab = {
    id: string
    path: string
    name: string
    content: string
    isDirty: boolean
    isSaving: boolean
    saveError?: string
    readOnly?: boolean
    /** How the file is stored on disk, so saving keeps its encoding and byte-order mark. UTF-8 when unset. */
    format?: TextFileFormat
    /** Set when the file couldn't be read safely as text, so the tab is read-only to protect it. */
    encodingIssue?: TextDecodeIssue
}

export type StudioLayoutState = {
    explorerOpen: boolean
    editorOpen: boolean
}

export const AUTO_SAVE_MS = 400
export const STORAGE_LAYOUT_EXPLORER = 'mermaid-studio-layout-explorer'
export const STORAGE_LAYOUT_EDITOR = 'mermaid-studio-layout-editor'
export const STORAGE_AUTOSAVE = 'mermaid-studio-autosave'
export const STORAGE_KEY_WIDTH = 'mermaid-studio-editor-width'
export const STORAGE_MERMAID_THEME = 'mermaid-studio-theme'
