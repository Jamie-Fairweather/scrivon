import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { KeybindBindings } from '@/lib/settings/types'

let layout = { explorerOpen: true, editorOpen: false, previewOpen: true }
let keybinds: KeybindBindings = createDefaultKeybinds(false)
const setExplorerOpen = vi.fn()
const setEditorOpen = vi.fn()
const setPreviewOpen = vi.fn()

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useStudioLayout: () => ({ layout, setExplorerOpen, setEditorOpen, setPreviewOpen }),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds } }),
}))
vi.mock('@/lib/settings/chord-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settings/chord-utils')>()),
    isMacPlatform: () => false,
}))

const { LayoutToggleButtons } = await import('./layout-toggle-buttons')

beforeEach(() => {
    layout = { explorerOpen: true, editorOpen: false, previewOpen: true }
    keybinds = createDefaultKeybinds(false)
    setExplorerOpen.mockClear()
    setEditorOpen.mockClear()
    setPreviewOpen.mockClear()
})

describe('LayoutToggleButtons', () => {
    it('tells screen readers whether each panel is shown', () => {
        render(<LayoutToggleButtons />)
        expect(screen.getByRole('button', { name: 'Toggle explorer' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Toggle editor' })).toHaveAttribute('aria-pressed', 'false')

        fireEvent.click(screen.getByRole('button', { name: 'Toggle editor' }))
        expect(setEditorOpen).toHaveBeenCalledWith(true)
    })

    it('hides and shows the preview', async () => {
        render(<LayoutToggleButtons />)
        const button = screen.getByRole('button', { name: 'Toggle preview' })
        expect(button).toHaveAttribute('aria-pressed', 'true')

        fireEvent.click(button)
        expect(setPreviewOpen).toHaveBeenCalledWith(false)

        act(() => button.focus())
        expect(await screen.findByText('Toggle preview (Ctrl+Alt+P)')).toBeInTheDocument()
    })

    it('shows the configured shortcut in the tooltip', async () => {
        keybinds = { ...keybinds, 'view.toggleEditor': [{ key: 'j', ctrl: true, shift: true }] }
        render(<LayoutToggleButtons />)

        act(() => screen.getByRole('button', { name: 'Toggle explorer' }).focus())
        expect(await screen.findByText('Toggle explorer (Ctrl+B)')).toBeInTheDocument()

        act(() => screen.getByRole('button', { name: 'Toggle editor' }).focus())
        expect(await screen.findByText('Toggle editor (Ctrl+Shift+J)')).toBeInTheDocument()
    })

    it('leaves the shortcut out when none is set', async () => {
        keybinds = { ...keybinds, 'view.toggleExplorer': [] }
        render(<LayoutToggleButtons />)

        act(() => screen.getByRole('button', { name: 'Toggle explorer' }).focus())
        expect(await screen.findByText('Toggle explorer')).toBeInTheDocument()
    })
})
