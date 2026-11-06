import { getBaseName, documentKind } from '@/lib/tauri/fs'
import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { FilePaletteItem, RecentPaletteItem, TabPaletteItem } from '@/components/studio/command-palette/types'

export const MAX_FILE_RESULTS = 20
export const MAX_TAB_RESULTS = 10
export const MAX_RECENT_RESULTS = 10

/** Comparison key for a path: slash direction is ignored, and so is letter case for Windows drive and network paths. */
function pathKey(path: string): string {
    const slashed = path.replace(/\\/g, '/')
    return /^([a-z]:|\/\/)/i.test(slashed) ? slashed.toLowerCase() : slashed
}

/**
 * Path below the workspace root. Windows tree paths mix separators (`C:\root/sub/a.md`),
 * so the root is matched whichever slash follows it.
 */
function relativePath(workspaceRoot: string, path: string): string {
    const root = workspaceRoot.replace(/[/\\]+$/, '')
    const separator = path[root.length]
    if ((separator === '/' || separator === '\\') && pathKey(path.slice(0, root.length)) === pathKey(root)) {
        return path.slice(root.length + 1)
    }
    return path
}

function toFileItem(path: string, workspaceRoot: string): FilePaletteItem {
    const name = getBaseName(path)
    const rel = relativePath(workspaceRoot, path)
    const kind = documentKind(name) ?? 'markdown'
    return {
        kind: 'file',
        value: `file:${path}`,
        searchText: `${name} ${rel}`,
        path,
        name,
        relativePath: rel,
        documentKind: kind,
    }
}

export function searchOpenTabs(
    tabs: Array<{ id: string; path: string; name: string; isDirty: boolean }>,
    query: string,
    isExample: (id: string) => boolean
): TabPaletteItem[] {
    const workspaceTabs = tabs.filter((t) => !isExample(t.id))
    const ranked = fuzzyRank(workspaceTabs, query, (t) => `${t.name} ${t.path}`)
    return ranked.slice(0, MAX_TAB_RESULTS).map(({ item }) => ({
        kind: 'tab',
        value: `tab:${item.path}`,
        searchText: `${item.name} ${item.path}`,
        path: item.path,
        name: item.name,
        isDirty: item.isDirty,
    }))
}

export function searchFiles(paths: string[], workspaceRoot: string, query: string): FilePaletteItem[] {
    const ranked = fuzzyRank(paths, query, (path) => {
        const name = getBaseName(path)
        const rel = relativePath(workspaceRoot, path)
        return `${name} ${rel}`
    })
    return ranked.slice(0, MAX_FILE_RESULTS).map(({ item }) => toFileItem(item, workspaceRoot))
}

export function searchRecentFiles(recentPaths: string[], workspaceRoot: string, query: string, openTabPaths: Set<string>): RecentPaletteItem[] {
    const filtered = recentPaths.filter((path) => !openTabPaths.has(path))
    const ranked = fuzzyRank(filtered, query, (path) => {
        const name = getBaseName(path)
        const rel = relativePath(workspaceRoot, path)
        return `${name} ${rel}`
    })

    return ranked.slice(0, MAX_RECENT_RESULTS).map(({ item }) => {
        const file = toFileItem(item, workspaceRoot)
        return { ...file, kind: 'recent' as const, value: `recent:${item}` }
    })
}
