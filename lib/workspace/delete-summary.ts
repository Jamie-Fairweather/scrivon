import { pathInside } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'

/** What deleting a file or folder does, in words for the confirm dialog. */
export type DeleteSummary = {
    title: string
    isDirectory: boolean
    /** Where it is in the opened folder (`docs\README.md`), so two files with one name can't be mixed up. */
    path: string
    /** For a folder, how many files go with it. */
    contents: string | null
    /** The open tabs that will close. */
    closingTabs: string | null
    /** Those of them whose unsaved changes will be lost. */
    unsaved: string | null
}

type ClosingTab = Pick<DocumentTab, 'path' | 'name' | 'isDirty'>

/** `a and b`, `a, b and c`, or `a, b, c and 2 more` past `max` names. */
function listNames(names: readonly string[], max = 3): string {
    if (names.length > max) return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
    if (names.length === 1) return names[0]!
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The files in the file list under `node`, and whether part of it couldn't be listed (so there may be more). */
function countFiles(node: FileNode): { count: number; partial: boolean } {
    if (node.kind === 'file') return { count: 1, partial: false }
    let count = 0
    let partial = Boolean(node.unreadable || node.truncated)
    for (const child of node.children) {
        const inner = countFiles(child)
        count += inner.count
        partial ||= inner.partial
    }
    return { count, partial }
}

function describeContents(node: FileNode): string {
    const { count, partial } = countFiles(node)
    if (partial && count === 0) return "Scrivon couldn't see what is in it."
    const files = count === 1 ? '1 file' : `${count} files`
    if (partial) return `It has at least ${files} in it.`
    return count === 0 ? 'It has no files in it.' : `It has ${files} in it.`
}

/**
 * Says what deleting `node` does: where it is in the opened folder `root`, how many files a folder takes with
 * it (as the file list shows them), and which of the open tabs `closingTabs` close and lose unsaved changes.
 */
export function describeDelete(node: FileNode, root: string | null, closingTabs: readonly ClosingTab[]): DeleteSummary {
    const isDirectory = node.kind === 'directory'
    // A tab inside a folder goes by where it is in that folder (`guide\README.md`), as names often repeat there,
    // kept in order on screen when it holds Hebrew or Arabic folder names.
    const names = (tabs: readonly ClosingTab[]) =>
        listNames(tabs.map((tab) => displayPath(isDirectory ? (pathInside(tab.path, node.path) ?? tab.name) : tab.name)))
    const unsaved = closingTabs.filter((tab) => tab.isDirty)
    let closing: string | null = null
    if (closingTabs.length > 0) {
        const count = closingTabs.length === 1 ? '1 open tab' : `${closingTabs.length} open tabs`
        closing = isDirectory ? `Closes ${count}: ${names(closingTabs)}.` : 'Closes its open tab.'
    }
    let lost: string | null = null
    if (unsaved.length > 0) lost = isDirectory ? `Unsaved changes in ${names(unsaved)} will be lost.` : 'Its unsaved changes will be lost.'
    return {
        title: isDirectory ? 'Delete folder?' : 'Delete file?',
        isDirectory,
        path: (root ? pathInside(node.path, root) : null) ?? node.path,
        contents: isDirectory ? describeContents(node) : null,
        closingTabs: closing,
        unsaved: lost,
    }
}
