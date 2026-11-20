import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RENDER_TIMEOUT_MESSAGE } from '@/lib/mermaid/render-errors'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { snippetText } from '@/lib/monaco/snippet-text'
import { uniqueNewName } from '@/lib/workspace/paths'
import { DiagramStartersProvider, starterPreviewKey, useDiagramStarters, type StarterGalleryRequest } from './diagram-starters-provider'

const {
    render: renderDiagram,
    theme,
    session,
    activeTab,
    promptName,
} = vi.hoisted(() => ({
    render: vi.fn<(source: string, themeId: string, documentKey: string, signal?: AbortSignal) => Promise<string>>(),
    theme: { themeId: 'scrivon-light' },
    session: {
        workspaceRoot: '/ws' as string | null,
        tree: [] as unknown[],
        createFile: vi.fn(async () => {}),
        createFolder: vi.fn(async () => {}),
        // The folder already has a sequence.mmd.
        suggestName: (_folder: string, name: string) => name,
        getNameError: () => null,
    },
    activeTab: { id: '/ws/docs/notes.md' as string | null },
    promptName: vi.fn(async (options: { defaultValue?: string }) => options.defaultValue ?? null),
}))

vi.mock('@/lib/mermaid/render-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mermaid/render-client')>()),
    renderMermaidDiagramAsync: renderDiagram,
}))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => theme }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => activeTab.id,
}))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))

const svgFor = (source: string, themeId: string) => `<svg xmlns="http://www.w3.org/2000/svg" data-theme="${themeId}"><title>${source}</title></svg>`

let request: StarterGalleryRequest = { primary: 'new-file', folder: '/ws/docs' }

/** Opens the window with `request` when its button is clicked, as a command does. */
function Opener() {
    const { openStarterGallery } = useDiagramStarters()
    return (
        <button type="button" onClick={() => openStarterGallery(request)}>
            Open starters
        </button>
    )
}

async function openGallery(next: StarterGalleryRequest = { primary: 'new-file', folder: '/ws/docs' }) {
    request = next
    const view = render(
        <DiagramStartersProvider>
            <Opener />
        </DiagramStartersProvider>
    )
    const opener = screen.getByRole('button', { name: 'Open starters' })
    opener.focus()
    act(() => opener.click())
    const dialog = await screen.findByRole('dialog')
    return { ...view, dialog, opener }
}

const cards = () => screen.getAllByRole('option')
const card = (name: string) => screen.getByRole('option', { name })

beforeEach(() => {
    vi.clearAllMocks()
    theme.themeId = 'scrivon-light'
    session.workspaceRoot = '/ws'
    session.suggestName = (_folder, name) => uniqueNewName(name, ['sequence.mmd'])
    activeTab.id = '/ws/docs/notes.md'
    renderDiagram.mockImplementation(async (source, themeId) => svgFor(source, themeId))
})

describe('DiagramStartersProvider', () => {
    it('shows one card per starter, as a listbox, each read out by its name and summary', async () => {
        await openGallery()

        expect(screen.getByRole('listbox', { name: 'Diagram starters' })).toBeInTheDocument()
        expect(cards().map((option) => option.textContent)).toEqual(MERMAID_SNIPPETS.map((snippet) => `${snippet.name}${snippet.summary}`))
        for (const snippet of MERMAID_SNIPPETS) {
            expect(card(snippet.name)).toHaveAccessibleDescription(snippet.summary)
        }
        expect(cards()[0]).toHaveAttribute('aria-selected', 'true')
        await waitFor(() => expect(cards()[0]).toHaveFocus())
    })

    it("draws each preview in the theme on screen under its own gallery key, never the open file's", async () => {
        const { dialog } = await openGallery()

        await waitFor(() => expect(dialog.querySelectorAll('img')).toHaveLength(MERMAID_SNIPPETS.length))
        const keys = renderDiagram.mock.calls.map(([, , documentKey]) => documentKey)
        expect(keys).toEqual(MERMAID_SNIPPETS.map(starterPreviewKey))
        expect(new Set(keys).size).toBe(MERMAID_SNIPPETS.length)
        expect(keys).not.toContain(activeTab.id)
        expect(renderDiagram.mock.calls.map(([source, themeId]) => [source, themeId])).toEqual(
            MERMAID_SNIPPETS.map((snippet) => [snippetText(snippet.body), 'scrivon-light'])
        )
        // Hidden from screen readers, and drawn from a data: URL so nothing in it reaches the app or the network.
        const img = dialog.querySelector('img')!
        expect(img).toHaveAttribute('alt', '')
        expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;/)
    })

    it('draws the previews again when the theme changes', async () => {
        const { dialog, rerender } = await openGallery()
        await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(MERMAID_SNIPPETS.length))

        theme.themeId = 'scrivon-dark'
        rerender(
            <DiagramStartersProvider>
                <Opener />
            </DiagramStartersProvider>
        )

        await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(MERMAID_SNIPPETS.length * 2))
        expect(renderDiagram.mock.calls.slice(MERMAID_SNIPPETS.length).every(([, themeId]) => themeId === 'scrivon-dark')).toBe(true)
        await waitFor(() => expect(decodeURIComponent(dialog.querySelector('img')!.getAttribute('src')!)).toContain('scrivon-dark'))
    })

    it('draws one preview at a time, and stops when the window closes', async () => {
        renderDiagram.mockImplementation(() => new Promise<string>(() => {}))
        await openGallery()
        await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(1))
        const signal = renderDiagram.mock.calls[0]![3]!
        expect(signal.aborted).toBe(false)

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(signal.aborted).toBe(true)
        expect(renderDiagram).toHaveBeenCalledTimes(1)
    })

    it('shows a short message on a card whose preview fails or takes too long, and it can still be picked', async () => {
        renderDiagram.mockImplementation(async (source, themeId) => {
            if (source.startsWith('sequenceDiagram')) throw new Error(RENDER_TIMEOUT_MESSAGE)
            if (source.startsWith('classDiagram')) throw new Error('Parse error on line 2')
            return svgFor(source, themeId)
        })
        await openGallery()

        const sequence = card('Sequence diagram')
        await waitFor(() => expect(within(sequence).getByText('Preview took too long to draw')).toBeInTheDocument())
        expect(sequence).toHaveAccessibleDescription(`${MERMAID_SNIPPETS[1].summary} Preview took too long to draw`)
        await waitFor(() => expect(within(card('Class diagram')).getByText("Preview couldn't be drawn")).toBeInTheDocument())

        fireEvent.click(sequence)
        expect(sequence).toHaveAttribute('aria-selected', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'New File' }))
        await waitFor(() => expect(session.createFile).toHaveBeenCalled())
    })

    it('makes a new file from the starter, with its text and a free name from its type', async () => {
        await openGallery()

        fireEvent.click(card('Sequence diagram'))
        fireEvent.click(screen.getByRole('button', { name: 'New File' }))

        await waitFor(() => expect(session.createFile).toHaveBeenCalledTimes(1))
        expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new-diagram', folder: '/ws/docs', defaultValue: 'sequence 2.mmd' }))
        const text = snippetText(MERMAID_SNIPPETS[1].body)
        expect(session.createFile).toHaveBeenCalledWith('/ws/docs', 'sequence 2.mmd', text)
        expect(text).not.toMatch(/\$/)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('makes no file when the name prompt is cancelled', async () => {
        promptName.mockResolvedValueOnce(null)
        await openGallery()

        fireEvent.click(screen.getByRole('button', { name: 'New File' }))

        await waitFor(() => expect(promptName).toHaveBeenCalled())
        expect(session.createFile).not.toHaveBeenCalled()
    })

    it('makes the new file where a new item would go for the open file, when no folder is given', async () => {
        session.tree = [
            { kind: 'directory', name: 'docs', path: '/ws/docs', children: [{ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' }] },
        ]
        await openGallery({ primary: 'insert', insert: { problem: () => null, run: vi.fn() } })

        fireEvent.click(screen.getByRole('button', { name: 'New File' }))

        await waitFor(() => expect(session.createFile).toHaveBeenCalledWith('/ws/docs', 'flowchart.mmd', snippetText(MERMAID_SNIPPETS[0].body)))
        session.tree = []
    })

    it('moves between cards with the arrow keys, Home and End, and runs the main button with Enter', async () => {
        const user = userEvent.setup()
        await openGallery()
        await waitFor(() => expect(cards()[0]).toHaveFocus())

        await user.keyboard('{ArrowRight}')
        expect(cards()[1]).toHaveFocus()
        expect(cards()[1]).toHaveAttribute('aria-selected', 'true')
        expect(cards()[0]).toHaveAttribute('tabindex', '-1')
        expect(cards()[1]).toHaveAttribute('tabindex', '0')
        await user.keyboard('{End}')
        expect(cards().at(-1)).toHaveFocus()
        await user.keyboard('{ArrowDown}')
        expect(cards().at(-1)).toHaveFocus()
        await user.keyboard('{Home}')
        expect(cards()[0]).toHaveFocus()
        await user.keyboard('{ArrowLeft}{ArrowDown}{ArrowDown}{ArrowUp}')
        expect(cards()[1]).toHaveFocus()

        // Tab leaves the group for the buttons.
        await user.tab()
        expect(cards().some((option) => option === document.activeElement)).toBe(false)
        await user.tab({ shift: true })
        expect(cards()[1]).toHaveFocus()

        await user.keyboard('{Enter}')
        await waitFor(() => expect(session.createFile).toHaveBeenCalledWith('/ws/docs', 'sequence 2.mmd', expect.any(String)))
    })

    it('closes on Escape and gives focus back where it was', async () => {
        const user = userEvent.setup()
        const { opener } = await openGallery()
        await waitFor(() => expect(cards()[0]).toHaveFocus())

        await user.keyboard('{Escape}')

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(opener).toHaveFocus()
        expect(session.createFile).not.toHaveBeenCalled()
    })

    it('turns New File off with no folder open', async () => {
        await openGallery({ primary: 'new-file', folder: null })

        expect(screen.getByRole('button', { name: 'New File' })).toBeDisabled()
        expect(screen.getByRole('status')).toHaveTextContent('Open a folder first')
    })
})

describe('DiagramStartersProvider opened to insert', () => {
    it('inserts the chosen starter once the window has closed, with New File offered too', async () => {
        const run = vi.fn()
        await openGallery({ primary: 'insert', insert: { problem: () => null, run } })

        expect(screen.getByRole('button', { name: 'New File' })).toBeEnabled()
        fireEvent.click(card('State diagram'))
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

        await waitFor(() => expect(run).toHaveBeenCalledExactlyOnceWith(MERMAID_SNIPPETS[3]))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(session.createFile).not.toHaveBeenCalled()
    })

    it('turns Insert off with the reason, leaving New File on, in a diagram file that has text', async () => {
        const run = vi.fn()
        await openGallery({ primary: 'insert', insert: { problem: () => 'This diagram file already has text', run } })

        expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled()
        expect(screen.getByRole('status')).toHaveTextContent('This diagram file already has text')
        await userEvent.setup().keyboard('{Enter}')
        expect(run).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'New File' }))
        await waitFor(() => expect(session.createFile).toHaveBeenCalledTimes(1))
        expect(run).not.toHaveBeenCalled()
    })

    it('checks again when Insert is pressed, and inserts nothing when the file has changed since it opened', async () => {
        const run = vi.fn()
        let problem: string | null = null
        await openGallery({ primary: 'insert', insert: { problem: () => problem, run } })
        expect(screen.getByRole('button', { name: 'Insert' })).toBeEnabled()

        // Text came in while the window was open (autosave, a reload from disk).
        problem = 'This diagram file already has text'
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('This diagram file already has text')
        expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled()
        expect(run).not.toHaveBeenCalled()
    })
})
