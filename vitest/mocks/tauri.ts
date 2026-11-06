import { vi } from 'vitest'

// Shared mocks for component tests (vitest.setup.ts). Every name the app imports from these modules must be
// defined here, or vitest throws 'No "x" export is defined on the mock' in whichever test first reaches it.
// vitest/mocks/tauri.test.tsx checks that against the app's imports.

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ''),
    readFile: vi.fn(async () => new Uint8Array()),
    stat: vi.fn(async () => ({ size: 0, isFile: true, isDirectory: false, isSymlink: false })),
    writeTextFile: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
    save: vi.fn(async () => null),
    message: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async () => undefined),
    isTauri: vi.fn(() => false),
}))

// An empty store, so the real lib/tauri/store.ts also works in a test that un-mocks it.
vi.mock('@tauri-apps/plugin-store', () => ({
    LazyStore: vi.fn(
        class {
            init = vi.fn(async () => undefined)
            get = vi.fn(async () => undefined)
            set = vi.fn(async () => undefined)
            has = vi.fn(async () => false)
            delete = vi.fn(async () => false)
            save = vi.fn(async () => undefined)
        }
    ),
}))

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
            getRecentWorkspaces: vi.fn(async () => []),
            addRecentWorkspace: vi.fn(async () => []),
            removeRecentWorkspace: vi.fn(async () => []),
            getLastOpenedFile: vi.fn(async () => null),
            setLastOpenedFile: vi.fn(async () => undefined),
            setWorkspaceTabSession: vi.fn(async () => undefined),
            getWorkspaceTabSession: vi.fn(async () => null),
            getRecentFiles: vi.fn(async () => []),
            addRecentFile: vi.fn(async () => []),
        }) satisfies typeof import('@/lib/tauri/store')
)
