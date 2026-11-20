import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import type { BatchExportRequest, BatchExportResult } from '@/lib/mermaid/batch-export'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings } from '@/lib/settings/types'
import type { DocumentTab } from '@/lib/workspace/types'
import { BatchExportProvider, useBatchExport, useExportRunning } from './batch-export-provider'

const ROOT = 'C:\\work\\notes'

const session = vi.hoisted(() => ({ workspaceRoot: 'C:\\work\\notes' as string | null, tabs: [] as DocumentTab[], desktop: true }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: session.workspaceRoot }),
    useDocumentTabs: () => ({ tabs: session.tabs }),
}))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => session.desktop }))
// Nord is dark, and the app shows it.
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'nord' }) }))
/** The saved settings, shared with every component that reads them, as the real provider does. */
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
            updateSettings: (patch: (current: AppSettings) => AppSettings) => settingsStore.set(patch(settingsStore.get())),
        }),
    }
})
const dialog = vi.hoisted(() => ({
    pickWorkspaceFolder: vi.fn<(title?: string) => Promise<string | null>>(async () => 'D:\\out'),
    confirmNameClash: vi.fn(async () => 'keep-both' as const),
}))
vi.mock('@/lib/tauri/dialog', () => dialog)
const opener = vi.hoisted(() => ({ revealItemInDir: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/plugin-opener', () => opener)

/** The export itself, run by the test: it resolves when the test says. */
const run = vi.hoisted(() => ({
    request: null as BatchExportRequest | null,
    finish: null as ((result: BatchExportResult | 'cancelled') => void) | null,
}))
vi.mock('@/lib/mermaid/batch-export', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mermaid/batch-export')>()),
    exportFolderDiagrams: vi.fn(
        (request: BatchExportRequest) =>
            new Promise((resolve) => {
                run.request = request
                run.finish = resolve
            })
    ),
}))

function result(change: Partial<BatchExportResult> = {}): BatchExportResult {
    return {
        folder: ROOT,
        outputFolder: 'D:\\out',
        found: 0,
        outcomes: [],
        cancelled: false,
        notTried: 0,
        truncated: false,
        unreadable: [],
        ...change,
    }
}

const shown = { commands: [] as readonly ShownCommand[], exporting: false, setExporting: (() => {}) as (exporting: boolean) => void }

/** What the palette and File menu see, and whether an export is running, as the tab bar's export reads it. */
function Probe() {
    const commands = useCommands()
    const { exporting, setExporting } = useExportRunning()
    useEffect(() => {
        shown.commands = commands
        shown.exporting = exporting
        shown.setExporting = setExporting
    })
    return null
}

/** Stands in for the explorer's folder menu. */
function FolderMenu({ folder }: { folder: string }) {
    const batch = useBatchExport()
    return (
        <button type="button" onClick={() => batch?.exportFolder(folder)}>
            Export {folder}
        </button>
    )
}

function renderProvider() {
    return render(
        <CommandRegistryProvider>
            <BatchExportProvider>
                <Probe />
                <FolderMenu folder={ROOT} />
                <FolderMenu folder={`${ROOT}\\sub`} />
            </BatchExportProvider>
        </CommandRegistryProvider>
    )
}

const command = () => shown.commands.find((c) => c.id === 'export-folder-diagrams')

/** Opens the options from the palette command, as F1 or File → Export does. */
async function openFromPalette() {
    await waitFor(() => expect(command()).toBeDefined())
    act(() => void command()!.run())
    return screen.findByRole('dialog', { name: 'Export diagrams' })
}

async function chooseFolderAndExport() {
    fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(run.request).not.toBeNull())
    return run.request!
}

beforeAll(async () => {
    // Loaded by the first export; loading it can take longer than waitFor waits.
    await import('@/lib/mermaid/batch-export')
})

beforeEach(() => {
    vi.clearAllMocks()
    session.workspaceRoot = ROOT
    session.tabs = []
    session.desktop = true
    run.request = null
    run.finish = null
    const defaults = createDefaultSettings(false)
    settingsStore.set({ ...defaults, theme: { ...defaults.theme, id: 'nord' } })
})

describe('Export All Diagrams in Folder…', () => {
    it('is in the palette, and opens the options for the open folder', async () => {
        renderProvider()

        const options = await openFromPalette()

        expect(command()).toMatchObject({ label: 'Export All Diagrams in Folder…', disabled: false })
        expect(within(options).getByText(/every \.mmd and \.mermaid file in notes/)).toBeInTheDocument()
    })

    it('is greyed out with a reason in the web build and with no folder open', async () => {
        session.desktop = false
        const view = renderProvider()
        await waitFor(() => expect(command()).toMatchObject({ disabled: true, disabledReason: 'Desktop only' }))
        view.unmount()

        session.desktop = true
        session.workspaceRoot = null
        renderProvider()
        await waitFor(() => expect(command()).toMatchObject({ disabled: true, disabledReason: 'No folder open' }))
    })

    it('keeps Export greyed out until an output folder is chosen, and says so', async () => {
        renderProvider()
        await openFromPalette()

        const exportButton = screen.getByRole('button', { name: 'Export' })
        expect(exportButton).toBeDisabled()
        expect(exportButton).toHaveAccessibleDescription('Choose a folder to save the diagrams in.')
        expect(screen.getByRole('textbox', { name: 'Output folder' })).toHaveValue('')

        fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' }))

        expect(dialog.pickWorkspaceFolder).toHaveBeenCalledWith('Choose Output Folder')
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Output folder' })).toHaveValue('D:\\out'))
        expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    })

    it('labels every control', async () => {
        renderProvider()
        await openFromPalette()

        expect(screen.getByRole('combobox', { name: 'Format' })).toHaveTextContent('SVG')
        expect(screen.getByRole('combobox', { name: 'Diagram Theme' })).toHaveTextContent('Same as App')
        expect(screen.getByRole('switch', { name: 'Transparent Background' })).not.toBeChecked()
        expect(screen.getByRole('switch', { name: /Include subfolders/ })).toBeChecked()
        expect(screen.getByRole('textbox', { name: 'Output folder' })).toBeInTheDocument()
    })

    it('shares the theme and background with the export menu', async () => {
        renderProvider()
        await openFromPalette()

        fireEvent.click(screen.getByRole('switch', { name: 'Transparent Background' }))
        expect(settingsStore.get().diagramExport.transparent).toBe(true)

        // Changed in the export menu meanwhile.
        act(() => settingsStore.set({ ...settingsStore.get(), diagramExport: { theme: 'light', transparent: false } }))
        expect(screen.getByRole('switch', { name: 'Transparent Background' })).not.toBeChecked()
        expect(screen.getByRole('combobox', { name: 'Diagram Theme' })).toHaveTextContent('Light')

        const request = await chooseFolderAndExport()
        // Light, for an app in Nord: its light twin.
        expect(request.settings.look).toEqual({ themeId: 'nord-light', transparent: false })
    })

    it('exports the folder with the options chosen, and the text of tabs with unsaved edits', async () => {
        session.tabs = [
            { id: 'a', path: `${ROOT}\\flow.mmd`, name: 'flow.mmd', content: 'graph LR\n  Edited', isDirty: true, isSaving: false },
            { id: 'b', path: `${ROOT}\\saved.mmd`, name: 'saved.mmd', content: 'graph TD', isDirty: false, isSaving: false },
        ]
        renderProvider()
        await openFromPalette()
        const user = userEvent.setup()
        await user.click(screen.getByRole('combobox', { name: 'Format' }))
        await user.click(await screen.findByRole('option', { name: 'PNG (4×)' }))
        fireEvent.click(screen.getByRole('switch', { name: /Include subfolders/ }))

        const request = await chooseFolderAndExport()

        expect(request).toMatchObject({
            folder: ROOT,
            outputFolder: 'D:\\out',
            settings: { image: { format: 'png', scale: 4 }, look: { themeId: 'nord', transparent: false }, includeSubfolders: false },
        })
        expect(request.unsavedText(`${ROOT}\\FLOW.mmd`)).toBe('graph LR\n  Edited')
        expect(request.unsavedText(`${ROOT}\\saved.mmd`)).toBeUndefined()
        await request.askNameClash(['sub\\flow.png'], true)
        expect(dialog.confirmNameClash).toHaveBeenCalledWith(['sub\\flow.png'], 'out', 'export', true)
    })

    it('exports the folder right-clicked in the explorer', async () => {
        renderProvider()

        fireEvent.click(screen.getByRole('button', { name: `Export ${ROOT}\\sub` }))
        expect(await screen.findByRole('dialog', { name: 'Export diagrams' })).toHaveTextContent('file in sub as a picture')

        expect((await chooseFolderAndExport()).folder).toBe(`${ROOT}\\sub`)
    })

    it('keeps the format and subfolder choice for the next export, but asks for the output folder again', async () => {
        renderProvider()
        await openFromPalette()
        fireEvent.click(screen.getByRole('switch', { name: /Include subfolders/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        await openFromPalette()

        expect(screen.getByRole('switch', { name: /Include subfolders/ })).not.toBeChecked()
        expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    })
})

describe('the progress dialog', () => {
    it('shows "Saving N of M" in a progress bar that screen readers announce politely', async () => {
        renderProvider()
        await openFromPalette()
        const request = await chooseFolderAndExport()

        expect(await screen.findByRole('dialog', { name: 'Exporting diagrams' })).toBeInTheDocument()
        expect(screen.getByRole('progressbar')).toHaveAccessibleName('Finding diagrams…')
        act(() => request.onProgress({ phase: 'saving', current: 3, total: 12 }))

        const bar = screen.getByRole('progressbar', { name: 'Saving 3 of 12' })
        expect(bar).toHaveAttribute('aria-valuenow', '3')
        expect(bar).toHaveAttribute('aria-valuemax', '12')
        expect(bar).toHaveAttribute('aria-valuetext', 'Saving 3 of 12')
        expect(screen.getByText('Saving 3 of 12')).toHaveAttribute('aria-live', 'polite')
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    it('runs one export at a time: greys out the command, and tells the single export', async () => {
        renderProvider()
        await openFromPalette()
        await chooseFolderAndExport()

        await waitFor(() => expect(command()).toMatchObject({ disabled: true, disabledReason: 'Exporting…' }))
        expect(shown.exporting).toBe(true)

        act(() => run.finish!(result()))
        await waitFor(() => expect(command()).toMatchObject({ disabled: false }))
        expect(shown.exporting).toBe(false)
    })

    it('is greyed out while a single export runs', async () => {
        renderProvider()
        await waitFor(() => expect(command()).toBeDefined())

        act(() => shown.setExporting(true))

        await waitFor(() => expect(command()).toMatchObject({ disabled: true, disabledReason: 'Exporting…' }))
        expect(shown.exporting).toBe(true)
    })

    it('cancels with the Cancel button, and stays open until the diagram being saved is done', async () => {
        renderProvider()
        await openFromPalette()
        const request = await chooseFolderAndExport()
        act(() => request.onProgress({ phase: 'saving', current: 2, total: 5 }))

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        expect(request.signal.aborted).toBe(true)
        expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
        expect(screen.getByRole('progressbar')).toHaveAccessibleName('Cancelling after diagram 2 of 5…')

        act(() => run.finish!(result({ found: 5, cancelled: true, notTried: 3, outcomes: [savedFlow, savedFlow2] })))
        expect(await screen.findByRole('dialog', { name: 'Export cancelled' })).toHaveTextContent('The 2 diagrams already saved are kept.')
        expect(screen.getByText('3 diagrams were not exported.')).toBeInTheDocument()
    })

    it('treats Escape as Cancel, and ignores a click outside', async () => {
        renderProvider()
        await openFromPalette()
        const request = await chooseFolderAndExport()

        fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' })

        await waitFor(() => expect(request.signal.aborted).toBe(true))
        expect(screen.getByRole('dialog', { name: 'Exporting diagrams' })).toBeInTheDocument()
    })

    it('goes back to the options when the name question is cancelled', async () => {
        renderProvider()
        await openFromPalette()
        await chooseFolderAndExport()

        act(() => run.finish!('cancelled'))

        expect(await screen.findByRole('dialog', { name: 'Export diagrams' })).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Output folder' })).toHaveValue('D:\\out')
    })
})

const savedFlow = { status: 'saved', source: 'flow.mmd', output: 'flow.svg', outputPath: 'D:\\out\\flow.svg' } as const
const savedFlow2 = { status: 'saved', source: 'sub\\flow.mmd', output: 'sub\\flow.svg', outputPath: 'D:\\out\\sub\\flow.svg' } as const

describe('the summary', () => {
    async function finishWith(done: BatchExportResult) {
        const view = renderProvider()
        await openFromPalette()
        await chooseFolderAndExport()
        act(() => run.finish!(done))
        return { view, summary: await screen.findByRole('dialog', { name: /^Export (finished|cancelled)$|^Couldn't export$/ }) }
    }

    it('lists what was saved, skipped and failed, with the reasons, for screen readers too', async () => {
        const { summary } = await finishWith(
            result({
                found: 5,
                outcomes: [
                    savedFlow,
                    { ...savedFlow2, note: 'This diagram is too big for 4×, so it was saved at 32767 × 1311 px.' },
                    { status: 'skipped', source: 'empty.mmd', reason: 'Nothing to export.' },
                    { status: 'failed', source: 'broken.mmd', reason: 'Invalid mermaid header' },
                    { status: 'failed', source: 'late.mmd', reason: "Couldn't save it. Disk full.", leftover: 'D:\\out\\.scrivon-save-x1.tmp' },
                ],
                truncated: true,
                unreadable: ['private'],
            })
        )

        expect(within(summary).getByRole('status')).toHaveTextContent('Saved 2 of 5 diagrams.')
        const saved = within(summary).getByRole('list', { name: 'Saved (2)' })
        expect(
            within(saved)
                .getAllByRole('listitem')
                .map((item) => item.textContent)
        ).toEqual([
            'flow.mmd→ saved as flow.svg',
            'sub\\flow.mmd→ saved as sub\\flow.svgThis diagram is too big for 4×, so it was saved at 32767 × 1311 px.',
        ])
        const skipped = within(summary).getByRole('list', { name: 'Skipped (1)' })
        expect(skipped).toHaveTextContent('empty.mmdNothing to export.')
        const failed = within(summary).getByRole('list', { name: 'Failed (2)' })
        expect(failed).toHaveTextContent('broken.mmdInvalid mermaid header')
        expect(failed).toHaveTextContent("Couldn't remove the temporary file D:\\out\\.scrivon-save-x1.tmp.")
        expect(summary).toHaveTextContent('too many files and folders to list them all')
        expect(summary).toHaveTextContent("Couldn't read a folder, so any diagrams in it were left out: private.")
        expect(within(summary).getByRole('button', { name: 'Done' })).toHaveFocus()
    })

    it('shows the folder with a saved file selected', async () => {
        await finishWith(result({ found: 2, outcomes: [savedFlow2, savedFlow] }))

        fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))

        expect(opener.revealItemInDir).toHaveBeenCalledWith('D:\\out\\flow.svg')
    })

    it('shows the output folder itself when nothing was saved at its top', async () => {
        await finishWith(result({ found: 1, outcomes: [savedFlow2] }))

        fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))

        expect(opener.revealItemInDir).toHaveBeenCalledWith('D:\\out')
    })

    it('says when the folder could not be read', async () => {
        const { summary } = await finishWith(result({ error: "Couldn't read notes. Access is denied." }))

        expect(summary).toHaveAccessibleName("Couldn't export")
        expect(within(summary).getByRole('status')).toHaveTextContent("Couldn't read notes. Access is denied.")
        expect(within(summary).queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument()
    })

    it('puts focus back where it was when it closes', async () => {
        renderProvider()
        const start = screen.getByRole('button', { name: `Export ${ROOT}` })
        start.focus()
        fireEvent.click(start)
        await screen.findByRole('dialog', { name: 'Export diagrams' })
        await chooseFolderAndExport()
        act(() => run.finish!(result({ found: 1, outcomes: [savedFlow] })))
        await screen.findByRole('dialog', { name: 'Export finished' })

        fireEvent.click(screen.getByRole('button', { name: 'Done' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(start).toHaveFocus())
    })
})
