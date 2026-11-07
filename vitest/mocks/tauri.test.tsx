import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render, screen } from '@testing-library/react'
import { LazyStore } from '@tauri-apps/plugin-store'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSessionProvider, useWorkspaceSession } from '@/components/studio/workspace/workspace-session-context'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { isTauri } from '@/lib/tauri/platform'

const root = join(__dirname, '..', '..')
const MOCKED_MODULES = [
    '@tauri-apps/plugin-fs',
    '@tauri-apps/plugin-dialog',
    '@tauri-apps/plugin-store',
    '@tauri-apps/api/core',
    '@/lib/tauri/platform',
    '@/lib/tauri/store',
]

function appSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return appSourceFiles(path)
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
    })
}

/** Value names (not types) that app code imports from `moduleName`, with the files that import each one. */
function importedNames(moduleName: string): Map<string, string[]> {
    const names = new Map<string, string[]>()
    const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g
    for (const file of ['app', 'components', 'hooks', 'lib'].flatMap((dir) => appSourceFiles(join(root, dir)))) {
        for (const [, typeOnly, list, from] of readFileSync(file, 'utf8').matchAll(pattern)) {
            if (from !== moduleName || typeOnly) continue
            for (const part of list.split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0]
                if (!name || name.startsWith('type ')) continue
                names.set(name, [...(names.get(name) ?? []), relative(root, file).replace(/\\/g, '/')])
            }
        }
    }
    return names
}

describe('shared Tauri mocks', () => {
    it.each(MOCKED_MODULES)('define everything the app imports from %s', async (moduleName) => {
        const mocked = Object.keys(await import(/* @vite-ignore */ moduleName))
        const imported = importedNames(moduleName)
        expect(imported.size).toBeGreaterThan(0)
        const missing = [...imported].filter(([name]) => !mocked.includes(name)).map(([name, files]) => `${name} (${files.join(', ')})`)
        expect(missing).toEqual([])
    })

    it('let the workspace session provider mount and load recent folders', async () => {
        function RecentCount() {
            const { hydrated, recentWorkspaces } = useWorkspaceSession()
            return <p>{hydrated ? `${recentWorkspaces.length} recent` : 'loading'}</p>
        }

        render(
            <WorkspaceSessionProvider coordinator={createWorkspaceCoordinatorRefs()}>
                <RecentCount />
            </WorkspaceSessionProvider>
        )

        expect(await screen.findByText('0 recent')).toBeInTheDocument()
    })

    it('let the real store module run against the LazyStore mock', async () => {
        const store = await vi.importActual<typeof import('@/lib/tauri/store')>('@/lib/tauri/store')
        vi.mocked(isTauri).mockReturnValue(true)
        try {
            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(await store.addRecentWorkspace('C:\\Notes')).toEqual(['C:\\Notes'])
            expect(await store.getWorkspaceTabSession('C:\\Notes')).toBeNull()
            await store.setLastOpenedFile('C:\\Notes', 'C:\\Notes\\a.md')
            expect(LazyStore).toHaveBeenCalledWith('workspace.json')
        } finally {
            vi.mocked(isTauri).mockReturnValue(false)
        }
    })
})
