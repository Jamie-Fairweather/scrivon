import type { MutableRefObject } from 'react'

import type { DocumentTab } from '@/lib/workspace/types'

export type WorkspaceCoordinatorRefs = {
    flushAllSaves: MutableRefObject<() => Promise<boolean>>
    flushSave: MutableRefObject<(id: string) => Promise<boolean>>
    flushSaveOnTabLeave: MutableRefObject<(id: string) => void>
    scheduleSave: MutableRefObject<(id: string) => void>
    /** For a tab that is closing: drops its pending autosave and its "couldn't save" notice. */
    cancelScheduledSave: MutableRefObject<(id: string) => void>
    getAutosaveEnabled: MutableRefObject<() => boolean>
    /** The error from the tab's last failed save, if its last save failed. */
    getSaveError: MutableRefObject<(id: string) => string | undefined>
    /** The text of the open tab for `path` when it has edits that aren't saved yet, otherwise undefined. */
    getUnsavedContent: MutableRefObject<(path: string) => string | undefined>
    /**
     * Gets tabs ready to close (all tabs when `ids` is left out): saves them, or asks the user
     * about unsaved or unsavable changes. Resolves false when the tabs must stay open.
     */
    confirmCloseTabs: MutableRefObject<(ids?: readonly string[]) => Promise<boolean>>
    remapTabsAfterRename: MutableRefObject<(oldPath: string, newPath: string, newName: string) => void>
    closeTabsForDelete: MutableRefObject<(path: string, isDirectory: boolean) => void>
    requestCanvasFit: MutableRefObject<() => void>
    clearTabs: MutableRefObject<() => void>
    setTabsFromWorkspace: MutableRefObject<(tabs: DocumentTab[], activeId: string | null) => void>
    persistWorkspaceTabSession: MutableRefObject<() => Promise<void>>
    openFile: MutableRefObject<(path: string) => Promise<void>>
    revealInEditor: MutableRefObject<(path: string, line: number, column: number, length?: number) => void>
    getEditorSelectedText: MutableRefObject<() => string | null>
}

export function createWorkspaceCoordinatorRefs(): WorkspaceCoordinatorRefs {
    return {
        flushAllSaves: { current: async () => true },
        flushSave: { current: async () => true },
        flushSaveOnTabLeave: { current: () => {} },
        scheduleSave: { current: () => {} },
        cancelScheduledSave: { current: () => {} },
        getAutosaveEnabled: { current: () => true },
        getSaveError: { current: () => undefined },
        getUnsavedContent: { current: () => undefined },
        confirmCloseTabs: { current: async () => true },
        remapTabsAfterRename: { current: () => {} },
        closeTabsForDelete: { current: () => {} },
        requestCanvasFit: { current: () => {} },
        clearTabs: { current: () => {} },
        setTabsFromWorkspace: { current: () => {} },
        persistWorkspaceTabSession: { current: async () => {} },
        openFile: { current: async () => {} },
        revealInEditor: { current: () => {} },
        getEditorSelectedText: { current: () => null },
    }
}
