import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { PreviewTextSize } from '@/components/studio/zoom/preview-text-size'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

let store: Map<string, string>
let update: ReturnType<typeof useAppSettings>['updateSettings'] = () => {}

function CaptureUpdate() {
    const { updateSettings } = useAppSettings()
    useEffect(() => {
        update = updateSettings
    }, [updateSettings])
    return null
}

function scale(): string {
    return document.documentElement.style.getPropertyValue('--preview-text-scale')
}

describe('PreviewTextSize', () => {
    beforeEach(() => {
        store = new Map()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        document.documentElement.style.removeProperty('--preview-text-scale')
    })

    it('scales the preview from the 14px it used to have, and follows changes', () => {
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { previewFontSize: 21 } }))
        render(
            <SettingsProvider>
                <PreviewTextSize />
                <CaptureUpdate />
            </SettingsProvider>
        )
        expect(scale()).toBe('1.5')

        act(() => update((current) => ({ ...current, appearance: { ...current.appearance, previewFontSize: 14 } })))
        expect(scale()).toBe('1')
    })
})
