'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { batchExportAvailability, buildBatchExportCommands } from '@/components/studio/batch-export/batch-export-commands'
import {
    BatchExportDialog,
    type BatchDialogView,
    type BatchImageChoice,
    type BatchSessionOptions,
} from '@/components/studio/batch-export/batch-export-dialog'
import { diagramExportThemeId } from '@/components/studio/editor/diagram-export-theme'
import type { Availability } from '@/components/studio/editor/export-availability'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import type { BatchImageFormat, BatchProgress } from '@/lib/mermaid/batch-export'
import { notifyError } from '@/lib/notify'
import type { DiagramExportSettings } from '@/lib/settings/types'
import { confirmNameClash, pickWorkspaceFolder } from '@/lib/tauri/dialog'
import { getBaseName, samePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab } from '@/lib/workspace/types'

/** Loaded when an export starts, so the export code and the diagram renderer aren't part of every launch. */
const loadBatchExport = () => import('@/lib/mermaid/batch-export')

/** Whether an export is running, single or batch. Only one runs at a time. */
type ExportRunning = {
    exporting: boolean
    /** For the single export (the tab bar's menu, the PDF dialog): says it started or finished. */
    setExporting: (exporting: boolean) => void
}

type BatchExportContextValue = {
    availability: Availability
    /** Opens the options for exporting the diagrams in `folder`. */
    exportFolder: (folder: string) => void
}

const ExportRunningContext = createContext<ExportRunning | null>(null)
const BatchExportContext = createContext<BatchExportContextValue | null>(null)

/**
 * The one "an export is running" flag. Outside a BatchExportProvider (a test of the export menu on its own),
 * the caller keeps its own.
 */
export function useExportRunning(): ExportRunning {
    const shared = useContext(ExportRunningContext)
    const [exporting, setExporting] = useState(false)
    return shared ?? { exporting, setExporting }
}

/** Exporting a folder's diagrams, for the explorer's folder menu. Null outside a BatchExportProvider. */
export function useBatchExport(): BatchExportContextValue | null {
    return useContext(BatchExportContext)
}

function imageFormat(choice: BatchImageChoice): BatchImageFormat {
    if (choice === 'svg') return { format: 'svg' }
    return { format: 'png', scale: choice === 'png-1' ? 1 : choice === 'png-2' ? 2 : 4 }
}

/** Keeps `tabsRef` up to date with the open tabs. On its own, so typing draws only this and not the dialog. */
function TrackTabs({ tabsRef }: { tabsRef: MutableRefObject<DocumentTab[]> }) {
    const { tabs } = useDocumentTabs()
    useEffect(() => {
        tabsRef.current = tabs
    }, [tabs, tabsRef])
    return null
}

/**
 * Export All Diagrams in Folder…: the command for the palette and File → Export (for the open folder), the
 * explorer's folder menu (through useBatchExport), and its dialog. It also holds whether any export is running,
 * which the single export reads (useExportRunning), so only one runs at a time.
 */
export function BatchExportProvider({ children }: { children: ReactNode }) {
    const { workspaceRoot } = useWorkspaceSession()
    const { themeId } = useAppTheme()
    const { settings, updateSettings } = useAppSettings()
    const diagramOptions = settings.diagramExport

    const [singleExporting, setSingleExporting] = useState(false)
    const [batchRunning, setBatchRunning] = useState(false)
    const exporting = singleExporting || batchRunning

    const [open, setOpen] = useState(false)
    const [view, setView] = useState<BatchDialogView | null>(null)
    // Kept for the session, not saved: the theme and background are the export menu's settings.
    const [options, setOptions] = useState<BatchSessionOptions>({ image: 'svg', includeSubfolders: true })
    const [outputFolder, setOutputFolder] = useState<string | null>(null)

    const tabsRef = useRef<DocumentTab[]>([])
    const controllerRef = useRef<AbortController | null>(null)
    // Where focus was when the export was started, to put it back when the dialog closes.
    const [returnFocus, setReturnFocus] = useState<Element | null>(null)

    const availability = useMemo(
        () => batchExportAvailability({ isDesktop: isTauri(), hasFolder: Boolean(workspaceRoot), exporting }),
        [workspaceRoot, exporting]
    )

    const exportFolder = useCallback(
        (folder: string) => {
            if (availability.disabled) return
            setReturnFocus(document.activeElement)
            // A new export starts with no output folder, so Export waits until one is chosen.
            setOutputFolder(null)
            setView({ step: 'options', folder })
            setOpen(true)
        },
        [availability.disabled]
    )
    const exportOpenFolder = useCallback(() => {
        if (workspaceRoot) exportFolder(workspaceRoot)
    }, [workspaceRoot, exportFolder])

    const commands = useMemo(() => buildBatchExportCommands({ availability, exportOpenFolder }), [availability, exportOpenFolder])
    useRegisterCommands(commands)

    const setDiagramOptions = useCallback(
        (change: Partial<DiagramExportSettings>) =>
            updateSettings((current) => ({ ...current, diagramExport: { ...current.diagramExport, ...change } })),
        [updateSettings]
    )

    const chooseFolder = useCallback(async () => {
        try {
            // Also lets the app write there: the export's file commands only work in folders the user picked.
            const picked = await pickWorkspaceFolder('Choose Output Folder')
            if (picked) setOutputFolder(picked)
        } catch (err) {
            notifyError("Couldn't choose the folder", err)
        }
    }, [])

    const runExport = useCallback(async () => {
        if (view?.step !== 'options' || !outputFolder || exporting) return
        const { folder } = view
        const controller = new AbortController()
        controllerRef.current = controller
        setBatchRunning(true)
        const showProgress = (progress: BatchProgress) =>
            setView((current) => ({ step: 'running', folder, progress, cancelling: current?.step === 'running' && current.cancelling }))
        showProgress({ phase: 'listing' })
        try {
            const code = await loadBatchExport()
            const result = await code.exportFolderDiagrams({
                folder,
                outputFolder,
                settings: {
                    image: imageFormat(options.image),
                    look: { themeId: diagramExportThemeId(diagramOptions.theme, themeId, settings.theme), transparent: diagramOptions.transparent },
                    includeSubfolders: options.includeSubfolders,
                },
                unsavedText: (path) => tabsRef.current.find((tab) => tab.isDirty && samePath(tab.path, path))?.content,
                signal: controller.signal,
                onProgress: showProgress,
                askNameClash: (names, canSkip) => confirmNameClash(names, getBaseName(outputFolder), 'export', canSkip),
            })
            // Cancelled at the name question: nothing was written, so the options come back to choose again.
            if (result === 'cancelled') setView({ step: 'options', folder })
            else setView({ step: 'summary', folder, summary: { result, headline: code.batchHeadline(result) } })
        } catch (err) {
            notifyError('Export failed', err)
            setOpen(false)
        } finally {
            controllerRef.current = null
            setBatchRunning(false)
        }
    }, [view, outputFolder, exporting, options, diagramOptions, themeId, settings.theme])

    const cancelExport = useCallback(() => {
        controllerRef.current?.abort()
        setView((current) => (current?.step === 'running' ? { ...current, cancelling: true } : current))
    }, [])

    const showInFolder = useCallback(() => {
        if (view?.step !== 'summary') return
        const { result } = view.summary
        // A file saved at the top of the output folder shows it selected; otherwise the folder itself is shown.
        const saved = result.outcomes.find((outcome) => outcome.status === 'saved' && !/[\\/]/.test(outcome.output))
        const path = saved?.status === 'saved' ? saved.outputPath : result.outputFolder
        revealItemInDir(path).catch((err: unknown) => notifyError('Could not show the folder', err))
    }, [view])

    const close = useCallback(() => {
        if (batchRunning) return
        setOpen(false)
    }, [batchRunning])

    const finalFocus = useCallback(() => (returnFocus instanceof HTMLElement && returnFocus.isConnected ? returnFocus : true), [returnFocus])

    const running = useMemo(() => ({ exporting, setExporting: setSingleExporting }), [exporting])
    const value = useMemo(() => ({ availability, exportFolder }), [availability, exportFolder])

    return (
        <ExportRunningContext.Provider value={running}>
            <BatchExportContext.Provider value={value}>
                <TrackTabs tabsRef={tabsRef} />
                {children}
                <BatchExportDialog
                    open={open}
                    view={view}
                    options={options}
                    onOptionsChange={(change) => setOptions((current) => ({ ...current, ...change }))}
                    diagramOptions={diagramOptions}
                    onDiagramOptionsChange={setDiagramOptions}
                    outputFolder={outputFolder}
                    onChooseFolder={() => void chooseFolder()}
                    blockedReason={singleExporting ? 'Another export is running. Try again when it has finished.' : null}
                    onExport={() => void runExport()}
                    onCancelExport={cancelExport}
                    onShowInFolder={showInFolder}
                    onClose={close}
                    finalFocus={finalFocus}
                />
            </BatchExportContext.Provider>
        </ExportRunningContext.Provider>
    )
}
