type TabForLabel = { id: string; path: string; name: string }

/** The folder names above a file, outermost first, for Windows or POSIX paths. */
function parentFolders(path: string): string[] {
    return path.split(/[/\\]/).filter(Boolean).slice(0, -1)
}

function lastFolders(folders: readonly string[], depth: number): string {
    return folders.slice(-depth).join('/')
}

/**
 * Tells apart open tabs whose files have the same name, like README.md in two folders: for each
 * of them, the fewest parent folders that no other same-named tab shares ('api' and 'guide', or
 * 'a/x' and 'b/x'). Tabs with a unique name get no entry. Names and folders are compared
 * ignoring case, as on Windows.
 */
export function getTabFolderHints(tabs: readonly TabForLabel[]): Map<string, string> {
    const hints = new Map<string, string>()
    const byName = new Map<string, TabForLabel[]>()
    for (const tab of tabs) {
        const key = tab.name.toLowerCase()
        byName.set(key, [...(byName.get(key) ?? []), tab])
    }

    for (const group of byName.values()) {
        if (group.length < 2) continue
        const folders = group.map((tab) => parentFolders(tab.path))
        group.forEach((tab, i) => {
            const own = folders[i]!
            for (let depth = 1; depth <= own.length; depth++) {
                const hint = lastFolders(own, depth)
                const shared = folders.some((other, j) => j !== i && lastFolders(other, depth).toLowerCase() === hint.toLowerCase())
                // With no unique ending (same folder, different case), show the whole folder path.
                if (!shared || depth === own.length) {
                    hints.set(tab.id, hint)
                    break
                }
            }
        })
    }
    return hints
}
