import { describe, expect, it, vi } from 'vitest'
import { registerCoordinatorRefs } from './register-coordinator-refs'
import { createWorkspaceCoordinatorRefs } from './workspace-coordinator'

describe('registerCoordinatorRefs', () => {
    it('assigns provided handlers to coordinator refs', () => {
        const refs = createWorkspaceCoordinatorRefs()
        const openFile = vi.fn(async () => undefined)
        const requestCanvasFit = vi.fn()

        registerCoordinatorRefs(refs, { openFile, requestCanvasFit })

        expect(refs.openFile.current).toBe(openFile)
        expect(refs.requestCanvasFit.current).toBe(requestCanvasFit)
    })

    it('skips undefined handlers', () => {
        const refs = createWorkspaceCoordinatorRefs()
        const original = refs.clearTabs.current

        registerCoordinatorRefs(refs, { openFile: undefined })

        expect(refs.clearTabs.current).toBe(original)
    })
})

describe('createWorkspaceCoordinatorRefs', () => {
    it('provides default no-op coordinator callbacks', async () => {
        const refs = createWorkspaceCoordinatorRefs()

        await expect(refs.flushAllSaves.current()).resolves.toBe(true)
        await expect(refs.flushSave.current('tab-1')).resolves.toBe(true)
        expect(() => refs.flushSaveOnTabLeave.current('tab-1')).not.toThrow()
        expect(() => refs.scheduleSave.current('tab-1')).not.toThrow()
        expect(() => refs.cancelScheduledSave.current('tab-1')).not.toThrow()
        expect(refs.getAutosaveEnabled.current()).toBe(true)
        expect(() => refs.remapTabsAfterRename.current('/ws/old.mmd', '/ws/new.mmd', 'new.mmd')).not.toThrow()
        expect(() => refs.closeTabsForDelete.current('/ws/old.mmd', false)).not.toThrow()
        expect(() => refs.requestCanvasFit.current()).not.toThrow()
        expect(() => refs.clearTabs.current()).not.toThrow()
        expect(() => refs.setTabsFromWorkspace.current([], null)).not.toThrow()
        await expect(refs.persistWorkspaceTabSession.current()).resolves.toBeUndefined()
        await expect(refs.openFile.current('/ws/a.mmd')).resolves.toBeUndefined()
        expect(() => refs.revealInEditor.current('/ws/a.mmd', 1, 1)).not.toThrow()
        expect(refs.getEditorSelectedText.current()).toBeNull()
    })
})
