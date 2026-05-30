import { vi } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ''),
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
}))

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => ({
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
    })),
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: vi.fn(() => false),
}))

vi.mock('@/lib/tauri/store', () => ({
    setWorkspaceTabSession: vi.fn(async () => undefined),
    getWorkspaceTabSession: vi.fn(async () => null),
}))
