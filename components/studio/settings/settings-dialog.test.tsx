import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/components/studio/settings/settings-dialog'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/storage'

// happy-dom has no Web Animations API, which Base UI's scroll area asks for.
if (!('getAnimations' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true })
}

function OpenSettingsButtons() {
    const { openSettings } = useAppSettings()
    return (
        <>
            <button type="button" onClick={() => openSettings('keyboard')}>
                Open keyboard settings
            </button>
            <button type="button" onClick={() => openSettings('editor')}>
                Open editor settings
            </button>
        </>
    )
}

function renderDialog() {
    return render(
        <SettingsProvider>
            <OpenSettingsButtons />
            <SettingsDialog />
        </SettingsProvider>
    )
}

describe('SettingsDialog sections', () => {
    let store: Map<string, string>

    beforeEach(() => {
        store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('names the open section in a heading and on the scrolling region', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))

        expect(await screen.findByRole('heading', { level: 3, name: 'Keyboard' })).toBeInTheDocument()
        const region = screen.getByRole('region', { name: 'Keyboard' })
        expect(screen.getByRole('button', { name: 'Keyboard' })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByRole('button', { name: 'Keyboard' })).toHaveAttribute('aria-controls', region.id)
    })

    it('opens each section at the top instead of where the last one was scrolled to', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))

        const keyboard = await screen.findByRole('region', { name: 'Keyboard' })
        keyboard.scrollTop = 400

        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

        const advanced = screen.getByRole('region', { name: 'Advanced' })
        expect(advanced).not.toBe(keyboard)
        expect(advanced.scrollTop).toBe(0)
    })

    it('saves a number typed into a field when Esc closes Settings straight away', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        const fontSize = (await screen.findByRole('textbox', { name: 'Font size' })) as HTMLInputElement
        act(() => fontSize.focus())
        fireEvent.change(fontSize, { target: { value: '1' } })
        fireEvent.change(fontSize, { target: { value: '16' } })
        fireEvent.keyDown(fontSize, { key: 'Escape' })

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        const saved = JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { editor?: { fontSize?: number } }
        expect(saved.editor?.fontSize).toBe(16)
    })
})
