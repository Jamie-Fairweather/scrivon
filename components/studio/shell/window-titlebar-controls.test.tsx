import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WindowTitlebarControls } from './window-titlebar-controls'

const calls = vi.hoisted(() => [] as string[])
const isMaximized = vi.hoisted(() => vi.fn(async () => false))

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        isMaximized,
        onResized: async () => () => {},
        close: async () => void calls.push('close'),
    }),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useFlushPendingSettings: () => () => void calls.push('flushPendingSettings'),
}))

describe('WindowTitlebarControls', () => {
    it('writes a settings change that is still waiting before it closes the window', async () => {
        render(<WindowTitlebarControls />)
        await waitFor(() => expect(isMaximized).toHaveBeenCalled())

        await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))

        expect(calls).toEqual(['flushPendingSettings', 'close'])
    })
})
