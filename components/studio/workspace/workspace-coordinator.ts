import type { MutableRefObject } from 'react'

import type { DocumentTab } from '@/lib/workspace/types'

export type WorkspaceCoordinatorRefs = {
    flushAllSaves: MutableRefObject<() => Promise<boolean>>
    flushSave: MutableRefObject<(id: string) => Promise<boolean>>
    flushSaveOnTabLeave: MutableRefObject<(id: string) => void>
    scheduleSave: MutableRefObject<(id: string) => void>
    cancelScheduledSave: MutableRefObject<(id: string) => void>
    getAutosaveEnabled: MutableRefObject<() => boolean>
    remapTabsAfterRename: MutableRefObject<(oldPath: string, newPath: string, newName: string) => void>
    closeTabsForDelete: MutableRefObject<(path: string, isDirectory: boolean) => void>
    requestCanvasFit: MutableRefObject<() => void>
    clearTabs: MutableRefObject<() => void>
    setTabsFromWorkspace: MutableRefObject<(tabs: DocumentTab[], activeId: string | null) => void>
    openFile: MutableRefObject<(path: string) => Promise<void>>
}

export function createWorkspaceCoordinatorRefs(): WorkspaceCoordinatorRefs {
    return {
        flushAllSaves: { current: async () => true },
        flushSave: { current: async () => true },
        flushSaveOnTabLeave: { current: () => {} },
        scheduleSave: { current: () => {} },
        cancelScheduledSave: { current: () => {} },
        getAutosaveEnabled: { current: () => true },
        remapTabsAfterRename: { current: () => {} },
        closeTabsForDelete: { current: () => {} },
        requestCanvasFit: { current: () => {} },
        clearTabs: { current: () => {} },
        setTabsFromWorkspace: { current: () => {} },
        openFile: { current: async () => {} },
    }
}
