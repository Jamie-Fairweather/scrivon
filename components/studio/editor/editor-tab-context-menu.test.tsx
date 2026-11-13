import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPath, revealInFileExplorer } from '@/lib/workspace/path-actions'
import type { DocumentTab } from '@/lib/workspace/types'
import { EditorTabRowContextMenu } from './editor-tab-context-menu'

const ROOT = 'C:\\Work\\notes'
let tabs: DocumentTab[] = []

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs, closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeAllTabs: vi.fn() }),
    useWorkspaceSession: () => ({ workspaceRoot: ROOT }),
}))
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

    it('has no path items for an example, which has no file', async () => {
        const example = tab('example:flowchart', { name: 'Flowchart.mmd', readOnly: true })
        tabs = [example]
        openMenuFor(example.id)

        expect(await screen.findByRole('menuitem', { name: 'Close' })).toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Reveal in File Explorer' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Copy Path' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Copy Relative Path' })).not.toBeInTheDocument()
    })

    it('only copies the full path of a file outside the open folder', async () => {
        const path = 'D:\\elsewhere\\plan.md'
        tabs = [tab(path)]
        openMenuFor(path)

        expect(await screen.findByRole('menuitem', { name: 'Reveal in File Explorer' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Copy Path' })).not.toHaveAttribute('aria-disabled')
    })
})
