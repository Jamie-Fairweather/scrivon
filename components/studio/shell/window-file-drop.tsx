'use client'

import { useEffect, useRef } from 'react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { notifyError, notifyInfo } from '@/lib/notify'
import { listenForFileDrops } from '@/lib/tauri/file-drop'
import { getBaseName, isPathInside, isSupportedDocument } from '@/lib/tauri/fs'
import { supportedExtensionsLabel } from '@/lib/workspace/file-types'
import { isImageFile } from '@/lib/workspace/image-assets'

type Session = Pick<ReturnType<typeof useWorkspaceSession>, 'workspaceRoot' | 'openFile' | 'openLaunchPaths' | 'pickAndOpenWorkspace'>

/** `notes.md`, or `3 files`. */
function nameOf(paths: readonly string[], several: string): string {
    return paths.length === 1 ? getBaseName(paths[0]!) : `${paths.length} ${several}`
}

/**
 * Opens what was dropped onto the window and not taken by the part of it under the drop (the editor takes
 * images). With a folder open, only files in it open, as from the explorer, so a stray drop never switches
 * folders. With none open, they open as from File Explorer, with their folder. The rest are explained.
 */
async function openDroppedFiles(paths: readonly string[], { workspaceRoot, openFile, openLaunchPaths, pickAndOpenWorkspace }: Session) {
    const documents = paths.filter(isSupportedDocument)
    const inFolder = documents.filter((path) => workspaceRoot !== null && isPathInside(path, workspaceRoot))
    const outside = workspaceRoot === null ? [] : documents.filter((path) => !inFolder.includes(path))
    const images = paths.filter(isImageFile)
    const others = paths.filter((path) => !isSupportedDocument(path) && !isImageFile(path))

    if (outside.length > 0) {
        const one = outside.length === 1
        notifyInfo(`${nameOf(outside, 'files')} ${one ? "isn't" : "aren't"} in the open folder`, {
            description: `Scrivon edits files inside the folder you open. Open ${one ? 'its' : 'their'} folder, then drop ${one ? 'it' : 'them'} again.`,
            action: { label: 'Open Folder…', onClick: () => void pickAndOpenWorkspace() },
        })
    }
    if (images.length > 0) {
        // Also said when they were dropped on the editor while it showed a diagram, an example or a read-only file.
        notifyInfo(`Can't add ${nameOf(images, 'images')} here`, {
            description: 'Images go into a Markdown file from the open folder. Drop them onto its text in the editor.',
        })
    }
    if (others.length > 0) {
        notifyInfo(`Can't open ${nameOf(others, 'files')}`, { description: `Scrivon opens ${supportedExtensionsLabel('and')} files.` })
    }
    if (workspaceRoot === null) {
        if (documents.length > 0) await openLaunchPaths(documents.map((path) => ({ path, isFolder: false })))
        return
    }
    // One at a time, so the last one dropped ends up showing.
    for (const path of inFolder) await openFile(path)
}

/**
 * Files dropped from File Explorer onto the window: Markdown and diagram files in the open folder open in
 * tabs, or, with no folder open, open with their folder.
 */
export function WindowFileDrop() {
    const { workspaceRoot, openFile, openLaunchPaths, pickAndOpenWorkspace } = useWorkspaceSession()
    // The latest, for drops; listening starts once.
    const sessionRef = useRef<Session>({ workspaceRoot, openFile, openLaunchPaths, pickAndOpenWorkspace })
    useEffect(() => {
        sessionRef.current = { workspaceRoot, openFile, openLaunchPaths, pickAndOpenWorkspace }
    }, [workspaceRoot, openFile, openLaunchPaths, pickAndOpenWorkspace])

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
