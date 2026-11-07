import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, invokeMock } = vi.hoisted(() => ({
    isTauriMock: vi.fn(),
    invokeMock: vi.fn(),
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: isTauriMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}))

import { allowWorkspacePath, forgetWorkspacePath } from './scope'

describe('allowWorkspacePath', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('no-ops outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await allowWorkspacePath('/home/project')
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('invokes allow_workspace in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        await allowWorkspacePath('/home/project')
        expect(invokeMock).toHaveBeenCalledWith('allow_workspace', { path: '/home/project' })
    })
})

describe('forgetWorkspacePath', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('no-ops outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await forgetWorkspacePath('/home/project')
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('invokes forget_workspace in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        await forgetWorkspacePath('/home/project')
        expect(invokeMock).toHaveBeenCalledWith('forget_workspace', { path: '/home/project' })
    })
})
