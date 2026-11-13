import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPath, revealInFileExplorer } from '@/lib/workspace/path-actions'
import type { DocumentTab } from '@/lib/workspace/types'
import { EditorTabRowContextMenu } from './editor-tab-context-menu'

const ROOT = 'C:\\Work\\notes'
let tabs: DocumentTab[] = []
const saveExampleCopy = vi.hoisted(() => vi.fn<(exampleId: string) => Promise<void>>(async () => undefined))
const tabActions = vi.hoisted(() => ({
    closeTab: vi.fn(async () => {}),
    closeOtherTabs: vi.fn(async () => {}),
    closeAllTabs: vi.fn(async () => {}),
    closeTabsToRight: vi.fn(async () => {}),
    closeSavedTabs: vi.fn(async () => {}),
    revertTab: vi.fn(async () => {}),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs, ...tabActions }),
    useWorkspaceSession: () => ({ workspaceRoot: ROOT }),
}))
vi.mock('@/components/studio/workspace/use-save-example-copy', () => ({ useSaveExampleCopy: () => saveExampleCopy }))
vi.mock('@/lib/workspace/path-actions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/workspace/path-actions')>()),
    revealInFileExplorer: vi.fn(async () => undefined),
    copyPath: vi.fn(async () => undefined),
}))

function tab(path: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: path, path, name: path.split(/[\\/]/).pop()!, content: '', isDirty: false, isSaving: false, ...extra }
}

const rightClickTab = () => fireEvent.contextMenu(screen.getByRole('button', { name: 'tab' }), { clientX: 10, clientY: 10 })

function openMenuFor(tabId: string) {
    render(
        <EditorTabRowContextMenu tabId={tabId}>
            <button type="button">tab</button>
        </EditorTabRowContextMenu>
    )
    rightClickTab()
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('EditorTabRowContextMenu', () => {
    it('closes the tabs to the right, the saved tabs, or reverts the file', async () => {
        tabs = [tab('C:/w/a.md'), tab('C:/w/b.md', { isDirty: true }), tab('C:/w/c.md')]
        openMenuFor('C:/w/b.md')

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Close',
            'Close Others',
            'Close to the Right',
            'Close Saved',
            'Close All',
            'Revert File',
            'Reveal in File Explorer',
            'Copy Path',
            'Copy Relative Path',
        ])
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close to the Right' }))
        expect(tabActions.closeTabsToRight).toHaveBeenCalledWith('C:/w/b.md')

        rightClickTab()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Close Saved' }))
        expect(tabActions.closeSavedTabs).toHaveBeenCalledTimes(1)

        rightClickTab()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Revert File' }))
        expect(tabActions.revertTab).toHaveBeenCalledWith('C:/w/b.md')
    })

    it('turns off Close to the Right for the last tab, and Close Saved when every tab has unsaved changes', async () => {
        tabs = [tab('C:/w/a.md', { isDirty: true }), tab('C:/w/b.md', { isDirty: true })]
        openMenuFor('C:/w/b.md')

        expect(await screen.findByRole('menuitem', { name: 'Close to the Right' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Close Saved' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Close Others' })).not.toHaveAttribute('aria-disabled')
    })

    it("reveals the tab's file in File Explorer and copies its path", async () => {
        const path = `${ROOT}\\docs\\plan.md`
        tabs = [tab(path)]
        openMenuFor(path)

        fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in File Explorer' }))
        expect(revealInFileExplorer).toHaveBeenCalledWith(path, ROOT)

        rightClickTab()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy Path' }))
        expect(copyPath).toHaveBeenLastCalledWith(path)

        rightClickTab()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy Relative Path' }))
        expect(copyPath).toHaveBeenLastCalledWith('docs\\plan.md', 'relative')
    })

    it('leaves the icons off, to line up with the Close items', async () => {
        const path = `${ROOT}\\docs\\plan.md`
        tabs = [tab(path)]
        openMenuFor(path)

        expect(await screen.findByRole('menuitem', { name: 'Close' })).toBeInTheDocument()
        for (const name of ['Reveal in File Explorer', 'Copy Path', 'Copy Relative Path']) {
            expect(screen.getByRole('menuitem', { name }).querySelector('svg')).toBeNull()
        }
        expect(screen.queryByText('Not in the open folder')).not.toBeInTheDocument()
    })

    it('has no path items or Revert for an example, which has no file', async () => {
        const example = tab('example:flowchart', { name: 'Flowchart.mmd', readOnly: true })
        tabs = [example]
        openMenuFor(example.id)

        expect(await screen.findByRole('menuitem', { name: 'Close' })).toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Revert File' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Reveal in File Explorer' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Copy Path' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Copy Relative Path' })).not.toBeInTheDocument()
    })

    it('saves a copy of an example into the folder', async () => {
        const example = tab('example:sample-1', { name: 'Simple Flow.mmd', readOnly: true })
        tabs = [example]
        openMenuFor(example.id)

        fireEvent.click(await screen.findByRole('menuitem', { name: 'Save Copy to Workspace' }))
        expect(saveExampleCopy).toHaveBeenCalledWith('sample-1')
    })

    it('offers Save Copy to Workspace only for examples', async () => {
        const path = `${ROOT}\\docs\\plan.md`
        tabs = [tab(path)]
        openMenuFor(path)

        expect(await screen.findByRole('menuitem', { name: 'Close' })).toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Save Copy to Workspace' })).not.toBeInTheDocument()
    })

    it('only copies the full path of a file outside the open folder', async () => {
        const path = 'D:\\elsewhere\\plan.md'
        tabs = [tab(path)]
        openMenuFor(path)

        expect(await screen.findByRole('menuitem', { name: 'Reveal in File Explorer' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Copy Path' })).not.toHaveAttribute('aria-disabled')
        // Says why the other two are greyed out.
        expect(screen.getByText('Not in the open folder')).toBeInTheDocument()
    })
})
