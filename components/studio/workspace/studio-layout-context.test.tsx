import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings } from '@/lib/settings/types'
import { StudioLayoutProvider, useStudioLayout } from './studio-layout-context'

const app = vi.hoisted(() => ({ settings: null as unknown as AppSettings }))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({
        settings: app.settings,
        updateSettings: (change: (current: AppSettings) => AppSettings) => {
            app.settings = change(app.settings)
        },
        setLayoutExplorerOpen: (open: boolean) => {
            app.settings = { ...app.settings, layout: { ...app.settings.layout, explorerOpen: open } }
        },
        setLayoutEditorOpen: (open: boolean) => {
            app.settings = { ...app.settings, layout: { ...app.settings.layout, editorOpen: open } }
        },
    }),
}))

const wrapper = ({ children }: { children: ReactNode }) => <StudioLayoutProvider>{children}</StudioLayoutProvider>

beforeEach(() => {
    app.settings = createDefaultSettings(false)
})

describe('StudioLayoutProvider', () => {
    it('shows and hides the Outline panel, and keeps the choice in settings', () => {
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })
        expect(result.current.layout.outlineOpen).toBe(false)

        act(() => result.current.setOutlineOpen(true))
        rerender()

        expect(app.settings.layout.outlineOpen).toBe(true)
        expect(result.current.layout.outlineOpen).toBe(true)
    })

    it('hides the Outline panel too for Preview Only', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, outlineOpen: true } }
        const { result } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setPreviewOnly())

        expect(app.settings.layout).toMatchObject({ explorerOpen: false, editorOpen: false, outlineOpen: false })
    })
})
