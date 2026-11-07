import { vi } from 'vitest'

// Shared mocks for component tests (vitest.setup.ts). Every name the app imports from these modules must be
// defined here, or vitest throws 'No "x" export is defined on the mock' in whichever test first reaches it.
// vitest/mocks/tauri.test.tsx checks that against the app's imports.

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ''),
    readFile: vi.fn(async () => new Uint8Array()),
    writeTextFile: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    stat: vi.fn(async () => ({ isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, nlink: null })),
    lstat: vi.fn(async () => ({ isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, nlink: null })),
    watch: vi.fn(async () => () => undefined),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
    save: vi.fn(async () => null),
    message: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/core', async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    return {
        // The app's save command (src-tauri/src/atomic_write.rs, sent by writeWorkspaceFile in lib/tauri/fs.ts)
        // writes through the plugin-fs mock here, so a test sees every save as a writeFile of the file itself.
        invoke: vi.fn(async (command: string, args?: unknown) => {
            if (command !== 'save_workspace_file' || !ArrayBuffer.isView(args)) return undefined
            const body = new Uint8Array(args.buffer, args.byteOffset, args.byteLength)
            const length = new DataView(body.buffer, body.byteOffset).getUint32(0, true)
            await fs.writeFile(new TextDecoder().decode(body.subarray(4, 4 + length)), body.slice(4 + length))
            return undefined
        }),
        isTauri: vi.fn(() => false),
    }
})

// getStore hands out an empty store with every public Store member (the `implements` makes tsc flag any that
// are missing), so the real lib/tauri/store.ts also works in a test that un-mocks it, whichever methods it calls.
type StoreApi = Pick<import('@tauri-apps/plugin-store').Store, keyof import('@tauri-apps/plugin-store').Store>
vi.mock('@tauri-apps/plugin-store', () => {
    class EmptyStore implements StoreApi {
        readonly rid = 0
        set = vi.fn(async () => undefined)
        get = vi.fn(async () => undefined)
        has = vi.fn(async () => false)
        delete = vi.fn(async () => false)
        clear = vi.fn(async () => undefined)
        reset = vi.fn(async () => undefined)
        keys = vi.fn(async () => [])
        values = vi.fn(async () => [])
        entries = vi.fn(async () => [])
        length = vi.fn(async () => 0)
        reload = vi.fn(async () => undefined)
        save = vi.fn(async () => undefined)
        onKeyChange = vi.fn(async () => () => undefined)
        onChange = vi.fn(async () => () => undefined)
        close = vi.fn(async () => undefined)
    }
    return { getStore: vi.fn(async () => new EmptyStore()) }
})

vi.mock(
    '@/lib/tauri/platform',
    () =>
        ({
            isTauri: vi.fn(() => false),
            isWindowsTauri: vi.fn(() => false),
        }) satisfies typeof import('@/lib/tauri/platform')
)

vi.mock(
    '@/lib/tauri/store',
    () =>
        ({
            clampRecentWorkspaceLimit: vi.fn((limit: number) => limit),
            getRecentWorkspaces: vi.fn(async () => []),
            addRecentWorkspace: vi.fn(async () => []),
            removeRecentWorkspace: vi.fn(async () => []),
            getLastOpenedFile: vi.fn(async () => null),
            setLastOpenedFile: vi.fn(async () => undefined),
            setWorkspaceTabSession: vi.fn(async () => undefined),
            getWorkspaceTabSession: vi.fn(async () => null),
            getFolderToggles: vi.fn(async () => []),
            setFolderToggles: vi.fn(async () => undefined),
            getRecentFiles: vi.fn(async () => []),
            addRecentFile: vi.fn(async () => []),
        }) satisfies typeof import('@/lib/tauri/store')
)
