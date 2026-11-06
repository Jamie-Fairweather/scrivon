import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/components/studio/settings/settings-dialog'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

// happy-dom has no Web Animations API, which Base UI's scroll area asks for.
if (!('getAnimations' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true })
}

function OpenKeyboardSettings() {
    const { openSettings } = useAppSettings()
    return (
        <button type="button" onClick={() => openSettings('keyboard')}>
            Open keyboard settings
        </button>
    )
}

function renderDialog() {
    return render(
        <SettingsProvider>
            <OpenKeyboardSettings />
            <SettingsDialog />
        </SettingsProvider>
    )
}

describe('SettingsDialog sections', () => {
    beforeEach(() => {
        const store = new Map<string, string>()
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
})
