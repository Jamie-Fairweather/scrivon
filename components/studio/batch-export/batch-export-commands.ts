import type { AppCommand } from '@/components/studio/commands/app-command'
import type { Availability } from '@/components/studio/editor/export-availability'

/** The id of Export All Diagrams in Folder…, which File → Export and the palette show. */
export const EXPORT_FOLDER_DIAGRAMS_ID = 'export-folder-diagrams'

export type BatchExportState = {
    /** The desktop app: the web build can't write files into a folder. */
    isDesktop: boolean
    hasFolder: boolean
    /** An export is running, single or batch; only one runs at a time. */
    exporting: boolean
}

/** Whether a folder's diagrams can be exported now, and why not when they can't. */
export function batchExportAvailability({ isDesktop, hasFolder, exporting }: BatchExportState): Availability {
    if (!isDesktop) return { disabled: true, reason: 'Desktop only' }
    if (!hasFolder) return { disabled: true, reason: 'No folder open' }
    if (exporting) return { disabled: true, reason: 'Exporting…' }
    return { disabled: false, reason: '' }
}

export type BatchExportCommandsContext = {
    availability: Availability
    /** Opens the options for the open folder. */
    exportOpenFolder: () => void
}

/** Export All Diagrams in Folder…, for the palette and File → Export. */
export function buildBatchExportCommands({ availability, exportOpenFolder }: BatchExportCommandsContext): AppCommand[] {
    return [
        {
            id: EXPORT_FOLDER_DIAGRAMS_ID,
            label: 'Export All Diagrams in Folder…',
            keywords: 'export save batch all every diagrams folder images svg png',
            disabled: availability.disabled,
            disabledReason: availability.reason || undefined,
            run: exportOpenFolder,
        },
    ]
}
