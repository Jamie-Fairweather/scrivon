'use client'

import { useEffect, useRef } from 'react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { notifyError, notifyInfo } from '@/lib/notify'
import { listenForFileDrops } from '@/lib/tauri/file-drop'
import { getBaseName, isPathInside, isSupportedDocument } from '@/lib/tauri/fs'
import { supportedExtensionsLabel } from '@/lib/workspace/file-types'
import { isImageFile } from '@/lib/workspace/image-assets'

type Session = Pick<ReturnType<typeof useWorkspaceSession>, 'workspaceRoot' | 'openFile' | 'pickAndOpenWorkspace'>

/** `notes.md`, or `3 files`. */
function nameOf(paths: readonly string[], several: string): string {
    return paths.length === 1 ? getBaseName(paths[0]!) : `${paths.length} ${several}`
}

/**
 * Opens what was dropped onto the window and not taken by the part of it under the drop (the editor takes
 * images). Only files in the open folder open, as from the explorer; the rest are explained.
 */
async function openDroppedFiles(paths: readonly string[], { workspaceRoot, openFile, pickAndOpenWorkspace }: Session) {
    const documents = paths.filter(isSupportedDocument)
    const inFolder = documents.filter((path) => workspaceRoot !== null && isPathInside(path, workspaceRoot))
    const outside = documents.filter((path) => !inFolder.includes(path))
    const images = paths.filter(isImageFile)
    const others = paths.filter((path) => !isSupportedDocument(path) && !isImageFile(path))

    if (outside.length > 0) {
        const one = outside.length === 1
        const what = nameOf(outside, 'files')
        notifyInfo(workspaceRoot ? `${what} ${one ? "isn't" : "aren't"} in the open folder` : `Open a folder to edit ${what}`, {
            description: `Scrivon edits files inside the folder you open. Open ${one ? 'its' : 'their'} folder, then drop ${one ? 'it' : 'them'} again.`,
            action: { label: 'Open Folder…', onClick: () => void pickAndOpenWorkspace() },
        })
    }
    if (images.length > 0) {
        notifyInfo('Drop images into the editor', { description: 'They are added to the Markdown file open there, where you drop them.' })
    }
    if (others.length > 0) {
        notifyInfo(`Can't open ${nameOf(others, 'files')}`, { description: `Scrivon opens ${supportedExtensionsLabel('and')} files.` })
    }
    // One at a time, so the last one dropped ends up showing.
    for (const path of inFolder) await openFile(path)
}

/** Files dropped from File Explorer onto the window: Markdown and diagram files in the open folder open in tabs. */
export function WindowFileDrop() {
    const { workspaceRoot, openFile, pickAndOpenWorkspace } = useWorkspaceSession()
    // The latest, for drops; listening starts once.
    const sessionRef = useRef<Session>({ workspaceRoot, openFile, pickAndOpenWorkspace })
    useEffect(() => {
        sessionRef.current = { workspaceRoot, openFile, pickAndOpenWorkspace }
    }, [workspaceRoot, openFile, pickAndOpenWorkspace])

    useEffect(() => {
        let disposed = false
        let stop: (() => void) | undefined
        listenForFileDrops(({ paths }) => {
            openDroppedFiles(paths, sessionRef.current).catch((err: unknown) => notifyError("Couldn't open the dropped file", err))
        })
            .then((unlisten) => {
                // The component may have gone while the listener was still being added.
                if (disposed) unlisten()
                else stop = unlisten
            })
            .catch((err: unknown) => console.warn("Couldn't listen for dropped files", err))
        return () => {
            disposed = true
            stop?.()
        }
    }, [])

    return null
}
