import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSettings } from '@/components/studio/settings/sections/editor-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

function ScrollSyncValue() {
    const { settings } = useAppSettings()
    return <output data-testid="scroll-sync">{String(settings.editor.scrollSync)}</output>
}

describe('EditorSettings', () => {
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

    it('turns scrolling with the preview off and on again', () => {
        render(
            <SettingsProvider>
                <EditorSettings />
                <ScrollSyncValue />
            </SettingsProvider>
        )

        const toggle = screen.getByRole('switch', { name: 'Scroll with the preview' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)
        expect(toggle).not.toBeChecked()
        expect(screen.getByTestId('scroll-sync')).toHaveTextContent('false')

        fireEvent.click(toggle)
        expect(screen.getByTestId('scroll-sync')).toHaveTextContent('true')
    })
})
