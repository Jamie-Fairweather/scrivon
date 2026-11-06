import { beforeEach, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(() => ({ value: undefined as unknown }))

vi.mock('@tauri-apps/plugin-store', () => ({
    LazyStore: class {
        init = async () => undefined
        get = async () => stored.value
        set = async () => undefined
        save = async () => undefined
    },
}))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))

const { getRecentWorkspaces } = await import('./store')

beforeEach(() => {
    stored.value = undefined
})

describe('getRecentWorkspaces', () => {
    it('drops entries that are not paths, so a damaged workspace.json cannot crash the welcome screen', async () => {
        stored.value = [null, 'C:/notes', 42, { path: 'x' }, 'D:/diagrams']

        await expect(getRecentWorkspaces()).resolves.toEqual(['C:/notes', 'D:/diagrams'])
    })

    it('returns an empty list when the stored value is not a list', async () => {
        stored.value = 'C:/notes'

        await expect(getRecentWorkspaces()).resolves.toEqual([])
    })
})
