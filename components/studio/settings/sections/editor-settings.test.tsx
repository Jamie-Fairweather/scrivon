import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSettings } from '@/components/studio/settings/sections/editor-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

function PreviewLinkValues() {
    const { settings } = useAppSettings()
    return (
        <>
            <output data-testid="scroll-sync">{String(settings.editor.scrollSync)}</output>
            <output data-testid="jump-from-preview">{String(settings.editor.jumpFromPreview)}</output>
        </>
    )
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

    function renderSettings() {
        render(
            <SettingsProvider>
                <EditorSettings />
                <PreviewLinkValues />
            </SettingsProvider>
        )
    }

    it('turns scrolling with the preview off and on again, leaving double-click alone', () => {
        renderSettings()
        const toggle = screen.getByRole('switch', { name: 'Scroll with the preview' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)
        expect(toggle).not.toBeChecked()
        expect(screen.getByTestId('scroll-sync')).toHaveTextContent('false')
        expect(screen.getByTestId('jump-from-preview')).toHaveTextContent('true')

        fireEvent.click(toggle)
        expect(screen.getByTestId('scroll-sync')).toHaveTextContent('true')
    })

    it('turns double-click to jump off and on again, leaving scrolling alone', () => {
        renderSettings()
        const toggle = screen.getByRole('switch', { name: 'Double-click the preview to jump to the editor' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)
        expect(toggle).not.toBeChecked()
        expect(screen.getByTestId('jump-from-preview')).toHaveTextContent('false')
        expect(screen.getByTestId('scroll-sync')).toHaveTextContent('true')

        fireEvent.click(toggle)
        expect(screen.getByTestId('jump-from-preview')).toHaveTextContent('true')
    })
})
