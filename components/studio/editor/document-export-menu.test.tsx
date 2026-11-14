import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import type { ExportFormat } from '@/lib/markdown/export-document'
import { copyPng, copySvg, exportPng, exportSvg, type DiagramLook } from '@/lib/mermaid/export'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings } from '@/lib/settings/types'
import type { DocumentTab } from '@/lib/workspace/types'
import { DocumentExportMenu } from './document-export-menu'
import { DocumentExportProvider, useDocumentExport } from './document-export-provider'

const tabs = vi.hoisted(() => ({ activeTab: null as DocumentTab | null }))
/** The Mermaid block expanded in the Markdown preview, if any. */
const expand = vi.hoisted(() => ({ expanded: null as { source: string; canvasKey: string } | null }))
/** Tabs whose web images the user chose to load in the preview. */
const remoteImageTabs = vi.hoisted(() => new Set<string>())
/** What drawing the diagram gave: an error, still drawing, or nothing to draw. */
const diagram = vi.hoisted(() => ({ currentError: null as string | null, isPending: false, isStale: false, isEmpty: false }))
type DialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    tabPath?: string
    workspaceRoot?: string | null
    allowRemoteImages?: boolean
    format?: ExportFormat
}
const dialogProps = vi.hoisted(() => ({ current: null as DialogProps | null }))
/** The props the export dialog last rendered with, or null when the menu left it out. */
const lastDialog = (): DialogProps | null => dialogProps.current

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTab: tabs.activeTab, activeTabId: tabs.activeTab?.id ?? null }),
    useWorkspaceSession: () => ({ workspaceRoot: 'D:\\docs' }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({
    useMarkdownExpand: () => ({ expanded: expand.expanded }),
    useMarkdownPreviewMemory: () => ({ scrollTopByTab: new Map(), remoteImageTabs, allowRemoteImages: () => undefined }),
}))
// Nord is dark, and its light twin is Nord Light.
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'nord' }) }))
/** The saved settings, shared by every component that reads them, as the real provider does. */
const settingsStore = vi.hoisted(() => {
    let current = {} as AppSettings
    const listeners = new Set<() => void>()
    return {
        get: () => current,
        set: (next: AppSettings) => {
            current = next
            for (const listener of listeners) listener()
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
})
vi.mock('@/components/studio/settings/settings-provider', async () => {
    const { useSyncExternalStore } = await import('react')
    return {
        useAppSettings: () => ({
            settings: useSyncExternalStore(settingsStore.subscribe, settingsStore.get),
            updateSettings: (patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) =>
                settingsStore.set(typeof patch === 'function' ? patch(settingsStore.get()) : { ...settingsStore.get(), ...patch }),
        }),
    }
})
vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: () => ({ error: diagram.currentError, ...diagram }) }))
vi.mock('@/lib/mermaid/export', () => ({ exportSvg: vi.fn(), exportPng: vi.fn(), copySvg: vi.fn(), copyPng: vi.fn() }))
vi.mock('@/components/studio/editor/pdf-export-dialog', () => ({
    PdfExportDialog: (props: DialogProps) => {
        dialogProps.current = props
        return null
    },
}))

function tab(name: string, content: string): DocumentTab {
    return { id: name, path: `D:\\docs\\${name}`, name, content, isDirty: false, isSaving: false }
}

/** The tooltip's own text (the button's description holds a hidden copy of it). */
const inTooltip = { selector: '[data-slot="tooltip-popup"] *' }

/** The menu as the tab bar shows it: inside the provider that holds the export. */
function ExportMenu() {
    return (
        <DocumentExportProvider>
            <DocumentExportMenu />
        </DocumentExportProvider>
    )
}

/** How a diagram looks with the default options: in the app's theme, on its background. */
const APP_LOOK: DiagramLook = { themeId: 'nord', transparent: false }

beforeEach(() => {
    tabs.activeTab = null
    expand.expanded = null
    dialogProps.current = null
    remoteImageTabs.clear()
    Object.assign(diagram, { currentError: null, isPending: false, isStale: false, isEmpty: false })
    const defaults = createDefaultSettings(false)
    // Nord all the time, as the mocked app theme shows.
    settingsStore.set({ ...defaults, theme: { ...defaults.theme, id: 'nord' } })
    for (const fn of [exportSvg, exportPng, copySvg, copyPng]) vi.mocked(fn).mockClear()
})

describe('DocumentExportMenu', () => {
    it('lets the PDF print web images only for a tab whose preview loaded them', () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<ExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(false)

        // The user clicked 'Load images' in this tab's preview.
        remoteImageTabs.add('notes.md')
        view.rerender(<ExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(true)

        // Another tab keeps its web images out of the PDF.
        tabs.activeTab = tab('other.md', '# Other')
        view.rerender(<ExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(false)
    })

    it('turns the export button off when no document is open, instead of opening an empty menu', async () => {
        render(<ExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        // Off but still focusable, so a keyboard user can hear why.
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).not.toBeDisabled()
        expect(button).not.toHaveAttribute('title')
        expect(button).toHaveAccessibleDescription('Open a document to export')

        act(() => button.focus())
        expect(await screen.findByText('Open a document to export', inTooltip)).toBeInTheDocument()

        fireEvent.click(button)
        expect(screen.queryByRole('menu')).toBeNull()
    })

    it('turns the export button on for a markdown document', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<ExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).not.toHaveAttribute('aria-disabled')
        expect(button).not.toHaveAttribute('title')
        // The export dialog gets the file's path so its save dialog starts in the same folder.
        expect(dialogProps.current?.tabPath).toBe('D:\\docs\\notes.md')
        // And the open folder, so the export can embed the images in it.
        expect(dialogProps.current?.workspaceRoot).toBe('D:\\docs')

        expect(button).not.toHaveAccessibleDescription()

        act(() => button.focus())
        // With the shortcut that opens the export dialog.
        expect(await screen.findByText('Export document (Ctrl+Shift+X)', inTooltip)).toBeInTheDocument()

        fireEvent.click(button)
        // Both document exports are marked as beta.
        expect(await screen.findByRole('menuitem', { name: 'Save PDF Beta' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Save Word Beta' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('menuitem', { name: 'Save HTML' }))
        await waitFor(() => expect(lastDialog()).toMatchObject({ open: true, format: 'html' }))
    })

    it.each([
        { case: 'an empty Markdown file', name: 'notes.md', content: '  \n', state: {}, reason: 'Nothing to export: the document is empty' },
        { case: 'an empty diagram', name: 'flow.mmd', content: '', state: {}, reason: 'Nothing to export: the diagram is empty' },
        {
            case: 'a diagram with an error',
            name: 'flow.mmd',
            content: 'graph TD; A--',
            state: { currentError: 'Parse error' },
            reason: 'Fix the diagram error to export',
        },
        { case: 'a diagram still drawing', name: 'flow.mmd', content: 'graph TD; A-->B', state: { isPending: true }, reason: 'Drawing the diagram…' },
        { case: 'a diagram with nothing to draw', name: 'flow.mmd', content: '%% note', state: { isEmpty: true }, reason: 'No diagram to export' },
    ])('says why the export button is off for $case, also to screen readers', async ({ name, content, state, reason }) => {
        Object.assign(diagram, state)
        tabs.activeTab = tab(name, content)
        render(<ExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveAccessibleDescription(reason)

        act(() => button.focus())
        expect(await screen.findByText(reason, inTooltip)).toBeInTheDocument()
    })

    it('shuts the open menu when the export button turns off', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<ExportMenu />)
        fireEvent.click(screen.getByRole('button', { name: 'Export document' }))
        expect(await screen.findByRole('menuitem', { name: 'Save PDF Beta' })).toBeInTheDocument()

        // An empty document has nothing to export.
        tabs.activeTab = tab('notes.md', '')
        view.rerender(<ExportMenu />)
        await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Save PDF Beta' })).toBeNull())
        expect(screen.getByRole('button', { name: 'Export document' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('does not pop the export dialog open again after a switch to a non-markdown tab and back', () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<ExportMenu />)
        act(() => lastDialog()?.onOpenChange(true))
        expect(lastDialog()?.open).toBe(true)

        // A Mermaid tab has no export dialog, so it goes away...
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        dialogProps.current = null
        view.rerender(<ExportMenu />)
        expect(lastDialog()).toBeNull()

        // ...and coming back to a Markdown tab must not reopen it by itself.
        tabs.activeTab = tab('notes.md', '# Notes')
        view.rerender(<ExportMenu />)
        expect(lastDialog()?.open).toBe(false)
    })

    it('greys out Save SVG and Save PNG while the edited diagram is still rendering behind the older picture (N19)', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->')
        diagram.isStale = true
        const view = render(<ExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        // The button itself stays on, so it doesn't flicker while typing.
        expect(button).not.toHaveAttribute('aria-disabled')

        fireEvent.click(button)
        const saveSvg = await screen.findByRole('menuitem', { name: 'Save SVG' })
        const savePng = screen.getByRole('menuitem', { name: 'Save PNG' })
        expect(saveSvg).toHaveAttribute('aria-disabled', 'true')
        expect(savePng).toHaveAttribute('aria-disabled', 'true')
        // A spinner on each says they are waiting for the drawing, not broken.
        expect(saveSvg).toHaveAttribute('aria-busy', 'true')
        expect(savePng).toHaveAttribute('aria-busy', 'true')
        expect(saveSvg.querySelector('svg.animate-spin')).not.toBeNull()
        expect(savePng.querySelector('svg.animate-spin')).not.toBeNull()
        fireEvent.click(saveSvg)
        // The export code loads on first use, so give a click that got through time to arrive.
        await act(async () => {
            await import('@/lib/mermaid/export')
        })
        expect(exportSvg).not.toHaveBeenCalled()

        // Once the text has rendered, the items turn back on.
        diagram.isStale = false
        view.rerender(<ExportMenu />)
        expect(screen.getByRole('menuitem', { name: 'Save PNG' })).not.toHaveAttribute('aria-disabled')
        expect(screen.getByRole('menuitem', { name: 'Save PNG' })).not.toHaveAttribute('aria-busy')
        const enabled = screen.getByRole('menuitem', { name: 'Save SVG' })
        expect(enabled).not.toHaveAttribute('aria-disabled')
        expect(enabled).not.toHaveAttribute('aria-busy')
        expect(enabled.querySelector('svg.animate-spin')).toBeNull()
        fireEvent.click(enabled)
        await waitFor(() => expect(exportSvg).toHaveBeenCalledWith('graph TD; A-->', APP_LOOK, expect.objectContaining({ tabName: 'flow.mmd' })))
    })
})

/** The commands the provider has registered, as the palette and the File menu see them. */
const registered = vi.hoisted(() => ({ current: [] as readonly ShownCommand[] }))

function CommandsProbe() {
    const commands = useCommands()
    useEffect(() => {
        registered.current = commands
    }, [commands])
    return null
}

function WithCommands({ children }: { children?: ReactNode }) {
    return (
        <CommandRegistryProvider>
            <DocumentExportProvider>
                <DocumentExportMenu />
                <CommandsProbe />
                {children}
            </DocumentExportProvider>
        </CommandRegistryProvider>
    )
}

function command(id: string): ShownCommand {
    const found = registered.current.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`No command ${id}`)
    return found
}

describe('export commands', () => {
    beforeEach(() => {
        registered.current = []
    })

    it('opens the export dialog at HTML from Export as HTML…', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<WithCommands />)
        await waitFor(() => expect(command('export-html').disabled).toBe(false))
        expect(lastDialog()?.open).toBe(false)

        act(() => void command('export-html').run())
        expect(lastDialog()).toMatchObject({ open: true, format: 'html' })
    })

    it('opens the dialog with Export… at the format picked last', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<WithCommands />)
        await waitFor(() => expect(command('export')).toMatchObject({ disabled: false, shortcut: 'Ctrl+Shift+X' }))

        act(() => void command('export-docx').run())
        act(() => lastDialog()?.onOpenChange(false))
        expect(lastDialog()?.open).toBe(false)

        act(() => void command('export').run())
        expect(lastDialog()).toMatchObject({ open: true, format: 'docx' })
    })

    it('opens the export menu with Export… for a Mermaid file, which has no dialog', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)
        await waitFor(() => expect(command('export').disabled).toBe(false))
        expect(command('export-pdf')).toMatchObject({ disabled: true, disabledReason: 'Only Markdown files export as PDF, Word or HTML' })

        act(() => void command('export').run())
        expect(await screen.findByRole('menuitem', { name: 'Save SVG' })).toBeInTheDocument()
        expect(lastDialog()).toBeNull()
    })

    it('saves the diagram as a PNG at the chosen size', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)
        await waitFor(() => expect(command('export-png-2').disabled).toBe(false))

        act(() => void command('export-png-2').run())
        await waitFor(() =>
            expect(exportPng).toHaveBeenCalledWith(
                'graph TD; A-->B',
                APP_LOOK,
                { tabName: 'flow.mmd', tabPath: 'D:\\docs\\flow.mmd', markdown: undefined },
                2
            )
        )
    })

    it('saves the diagram expanded from a Markdown file, named after the file', async () => {
        tabs.activeTab = tab('notes.md', '# Notes\n\n```mermaid\ngraph LR; X-->Y\n```')
        expand.expanded = { source: 'graph LR; X-->Y', canvasKey: 'notes.md#0' }
        render(<WithCommands />)
        await waitFor(() => expect(command('export-svg').disabled).toBe(false))

        act(() => void command('export-svg').run())
        await waitFor(() =>
            expect(exportSvg).toHaveBeenCalledWith('graph LR; X-->Y', APP_LOOK, {
                tabName: 'notes.md',
                tabPath: 'D:\\docs\\notes.md',
                markdown: '# Notes\n\n```mermaid\ngraph LR; X-->Y\n```',
            })
        )
    })

    it('greys out every export while one runs', async () => {
        let finish = () => {}
        vi.mocked(exportSvg).mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)
        await waitFor(() => expect(command('export-svg').disabled).toBe(false))

        act(() => void command('export-svg').run())
        await waitFor(() => expect(command('export').disabledReason).toBe('Exporting…'))
        expect(command('export-png-1').disabled).toBe(true)

        await act(async () => finish())
        await waitFor(() => expect(command('export').disabled).toBe(false))
    })

    it('says so when the export code fails to load', async () => {
        const notify = await import('@/lib/notify')
        const notifyError = vi.spyOn(notify, 'notifyError').mockReturnValue('')
        vi.mocked(exportSvg).mockRejectedValueOnce(new Error('chunk failed'))
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)
        await waitFor(() => expect(command('export-svg').disabled).toBe(false))

        act(() => void command('export-svg').run())
        await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Export failed', new Error('chunk failed')))
        await waitFor(() => expect(command('export').disabled).toBe(false))
        notifyError.mockRestore()
    })
})

describe('diagram options and copying (F45)', () => {
    beforeEach(() => {
        registered.current = []
    })

    /** Opens the tab bar's export menu. */
    async function openMenu() {
        fireEvent.click(screen.getByRole('button', { name: 'Export document' }))
        return screen.findByRole('menu')
    }

    it('copies a Mermaid file as PNG or SVG from the export menu', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<ExportMenu />)

        await openMenu()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy PNG' }))
        await waitFor(() => expect(copyPng).toHaveBeenCalledWith('graph TD; A-->B', APP_LOOK))

        await openMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy SVG' }))
        await waitFor(() => expect(copySvg).toHaveBeenCalledWith('graph TD; A-->B', APP_LOOK))
        expect(exportPng).not.toHaveBeenCalled()
        expect(exportSvg).not.toHaveBeenCalled()
    })

    it('greys out copying while the diagram is redrawn', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->')
        diagram.isStale = true
        render(<ExportMenu />)

        await openMenu()
        expect(screen.getByRole('menuitem', { name: 'Copy PNG' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('menuitem', { name: 'Copy SVG' })).toHaveAttribute('aria-busy', 'true')
    })

    it('copies the diagram expanded from a Markdown file from the palette', async () => {
        tabs.activeTab = tab('notes.md', '# Notes\n\n```mermaid\ngraph LR; X-->Y\n```')
        expand.expanded = { source: 'graph LR; X-->Y', canvasKey: 'notes.md#0' }
        render(<WithCommands />)
        await waitFor(() => expect(command('copy-diagram-png').disabled).toBe(false))

        act(() => void command('copy-diagram-png').run())
        await waitFor(() => expect(copyPng).toHaveBeenCalledWith('graph LR; X-->Y', APP_LOOK))
        act(() => void command('copy-diagram-svg').run())
        await waitFor(() => expect(copySvg).toHaveBeenCalledWith('graph LR; X-->Y', APP_LOOK))
    })

    it('saves a transparent background, ticked in the menu, and uses it for the next export', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)

        await openMenu()
        const transparent = screen.getByRole('menuitemcheckbox', { name: 'Transparent background' })
        expect(transparent).toHaveAttribute('aria-checked', 'false')
        fireEvent.click(transparent)

        await waitFor(() => expect(settingsStore.get().diagramExport.transparent).toBe(true))
        expect(screen.getByRole('menuitemcheckbox', { name: 'Transparent background' })).toHaveAttribute('aria-checked', 'true')
        // The palette shows it too.
        expect(command('diagram-export-transparent').checked).toBe(true)

        act(() => void command('export-png-2').run())
        await waitFor(() => expect(exportPng).toHaveBeenCalledWith('graph TD; A-->B', { themeId: 'nord', transparent: true }, expect.anything(), 2))
    })

    it('draws diagrams in the light or dark version of the app theme, as picked in the menu', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        render(<WithCommands />)

        await openMenu()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Diagram theme' }))
        const light = await screen.findByRole('menuitemradio', { name: 'Light' })
        expect(screen.getByRole('menuitemradio', { name: 'Same as App' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(light)
        await waitFor(() => expect(settingsStore.get().diagramExport.theme).toBe('light'))

        act(() => void command('copy-diagram-svg').run())
        await waitFor(() => expect(copySvg).toHaveBeenCalledWith('graph TD; A-->B', { themeId: 'nord-light', transparent: false }))

        // And back to the app's own theme from the palette.
        act(() => void command('diagram-export-theme-app').run())
        await waitFor(() => expect(settingsStore.get().diagramExport.theme).toBe('app'))
    })

    it('shows no diagram options for a Markdown file with no diagram expanded', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<ExportMenu />)

        await openMenu()
        expect(screen.queryByRole('menuitem', { name: 'Copy PNG' })).toBeNull()
        expect(screen.queryByRole('menuitemcheckbox', { name: 'Transparent background' })).toBeNull()
    })
})

describe('useDocumentExport', () => {
    it('needs the provider', () => {
        function Lonely() {
            useDocumentExport()
            return null
        }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => render(<Lonely />)).toThrow('useDocumentExport must be used within DocumentExportProvider')
        vi.mocked(console.error).mockRestore()
    })
})
