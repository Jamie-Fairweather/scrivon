import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { snippetText } from '@/lib/monaco/snippet-text'
import { DiagramStartersProvider, useDiagramStarters, type StarterGalleryRequest } from './diagram-starters-provider'

// The real name prompt, as it opens while the starters window closes and the two hand focus between them.
const { session, focusEditorFor } = vi.hoisted(() => ({
    session: {
        workspaceRoot: '/ws' as string | null,
        tree: [] as unknown[],
        createFile: vi.fn(async () => {}),
        createFolder: vi.fn(async () => {}),
        suggestName: (_folder: string, name: string) => name,
        getNameError: () => null,
    },
    focusEditorFor: vi.fn(),
}))

vi.mock('@/lib/mermaid/render-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mermaid/render-client')>()),
    renderMermaidDiagramAsync: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
}))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'scrivon-light' }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => null,
}))
vi.mock('@/components/studio/editor/editor-focus', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/studio/editor/editor-focus')>()),
    focusEditorFor,
}))

let request: StarterGalleryRequest = { primary: 'new-file', folder: '/ws' }

function Opener() {
    const { openStarterGallery } = useDiagramStarters()
    return (
        <>
            <textarea aria-label="Editor" />
            <button type="button" onClick={() => openStarterGallery(request)}>
                Open starters
            </button>
        </>
    )
}

async function openFromEditor(next: StarterGalleryRequest) {
    request = next
    render(
        <NamePromptProvider>
            <DiagramStartersProvider>
                <Opener />
            </DiagramStartersProvider>
        </NamePromptProvider>
    )
    const editor = screen.getByLabelText('Editor')
    editor.focus()
    // As a command does: the window opens with focus where the user was.
    act(() => screen.getByRole('button', { name: 'Open starters' }).click())
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveFocus())
    return editor
}

/** Lets the dialogs' closing steps (animations end at once here) and their focus moves run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)))

beforeEach(() => {
    vi.clearAllMocks()
})

describe('Diagram Starters focus', () => {
    it('leaves focus in the name prompt after New File, so the typed name goes there and not into the editor', async () => {
        const user = userEvent.setup()
        const editor = await openFromEditor({ primary: 'new-file', folder: '/ws' })

        await user.keyboard('{ArrowRight}{Enter}')

        const name = await screen.findByLabelText('Name')
        await settle()
        expect(name).toHaveFocus()
        expect(editor).not.toHaveFocus()

        await user.keyboard('{Control>}a{/Control}chart.mmd{Enter}')
        await waitFor(() => expect(session.createFile).toHaveBeenCalledWith('/ws', 'chart.mmd', snippetText(MERMAID_SNIPPETS[1].body)))
        expect((editor as HTMLTextAreaElement).value).toBe('')
        // The new file's editor takes focus once its tab shows.
        expect(focusEditorFor).toHaveBeenCalledWith('/ws/chart.mmd')
    })

    it('gives focus back where it was when New File is chosen and the name prompt is then cancelled', async () => {
        const user = userEvent.setup()
        const editor = await openFromEditor({ primary: 'insert', insert: { problem: () => null, run: vi.fn() } })

        await user.click(screen.getByRole('button', { name: 'New File' }))
        const name = await screen.findByLabelText('Name')
        await settle()
        expect(name).toHaveFocus()

        await user.keyboard('{Escape}')
        await settle()
        expect(session.createFile).not.toHaveBeenCalled()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(editor).toHaveFocus()
    })

    it('leaves focus to the editor after Insert', async () => {
        const user = userEvent.setup()
        const other = document.createElement('input')
        const run = vi.fn(() => other.focus())
        await openFromEditor({ primary: 'insert', insert: { problem: () => null, run } })
        document.body.append(other)

        await user.keyboard('{Enter}')
        await settle()

        expect(run).toHaveBeenCalledExactlyOnceWith(MERMAID_SNIPPETS[0])
        // run gives the editor focus (runInEditor); the window doesn't take it back afterwards.
        expect(other).toHaveFocus()
        other.remove()
    })
})
