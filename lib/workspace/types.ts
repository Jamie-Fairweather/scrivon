import type { TextDecodeIssue, TextFileFormat } from '@/lib/workspace/text-encoding'

export type FileNode =
    | {
          kind: 'directory'
          name: string
          path: string
          children: FileNode[]
          /** The folder couldn't be listed (no permission, or gone while reading), so `children` is empty. */
          unreadable?: true
          /** It is a link to a folder outside the opened one, which Scrivon can't open yet (also `unreadable`). */
          linksOutside?: true
          /** Not read: the opened folder has too many files and folders to list them all, so `children` is empty. */
          truncated?: true
      }
    | {
          kind: 'file'
          name: string
          path: string
      }

/** When a file was last changed and how big it was, to tell whether someone else changed it since. */
export type FileStamp = { mtimeMs: number | null; size: number }

/**
 * What Scrivon last knew about a tab's file on disk. Every copy of a tab shares this one object (tabs are
 * copied on each edit), so a save can update it without waiting for React. Never render from it.
 */
export type TabDiskRecord = {
    /** From the last read or save; null when it couldn't be read, which only checks the file is still there. */
    stamp: FileStamp | null
    /** Set when the user chose not to save over a change made outside Scrivon; autosave then leaves the tab alone. */
    conflict?: 'changed' | 'deleted'
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
    /** Set when the file is big enough to make editing slow, so it opened read-only until the user chooses to edit it. */
    largeFile?: true
    /** Set for tabs read from disk, so saves can tell when the file was changed or deleted outside Scrivon. */
    disk?: TabDiskRecord
}

export type StudioLayoutState = {
    explorerOpen: boolean
    editorOpen: boolean
    /** The Markdown preview or the diagram. At least one of editor and preview is always shown. */
    previewOpen: boolean
    outlineOpen: boolean
}

/** Whether the preview is on screen. With the editor hidden too, it shows anyway. */
export function isPreviewShown(layout: { previewOpen: boolean; editorOpen: boolean }): boolean {
    return layout.previewOpen || !layout.editorOpen
}

export const AUTO_SAVE_MS = 400
export const STORAGE_LAYOUT_EXPLORER = 'mermaid-studio-layout-explorer'
export const STORAGE_LAYOUT_EDITOR = 'mermaid-studio-layout-editor'
export const STORAGE_AUTOSAVE = 'mermaid-studio-autosave'
export const STORAGE_KEY_WIDTH = 'mermaid-studio-editor-width'
export const STORAGE_MERMAID_THEME = 'mermaid-studio-theme'
