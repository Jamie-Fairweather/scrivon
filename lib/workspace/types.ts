export type FileNode =
    | {
          kind: 'directory'
          name: string
          path: string
          children: FileNode[]
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
