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

    it('hides and shows the preview, and keeps the choice in settings', () => {
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })
        expect(result.current.layout.previewOpen).toBe(true)

        act(() => result.current.setPreviewOpen(false))
        rerender()

        expect(app.settings.layout.previewOpen).toBe(false)
        expect(result.current.layout).toMatchObject({ editorOpen: true, previewOpen: false })
    })

    it('shows the editor when the preview is hidden while the editor is hidden, and the other way round', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, editorOpen: false, previewOpen: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setPreviewOpen(false))
        rerender()
        expect(app.settings.layout).toMatchObject({ editorOpen: true, previewOpen: false })

        act(() => result.current.setEditorOpen(false))
        rerender()
        expect(app.settings.layout).toMatchObject({ editorOpen: false, previewOpen: true })
        expect(result.current.layout).toMatchObject({ editorOpen: false, previewOpen: true })
    })

    it('never says both the editor and the preview are hidden', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, editorOpen: false, previewOpen: false } }
        const { result } = renderHook(() => useStudioLayout(), { wrapper })

        expect(result.current.layout).toMatchObject({ editorOpen: false, previewOpen: true })
    })

    it('shows the preview for Preview Only, also when it was hidden', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, previewOpen: false } }
        const { result } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setPreviewOnly())

        expect(app.settings.layout).toMatchObject({ editorOpen: false, previewOpen: true })
    })

    it('shows only the editor in focus mode, and brings back exactly the panes there were when it ends', () => {
        app.settings = {
            ...app.settings,
            layout: { ...app.settings.layout, explorerOpen: false, outlineOpen: true, previewOpen: false, editorWidth: 520 },
        }
        const saved = app.settings.layout
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setFocusMode(true))
        rerender()
        expect(result.current.focusMode).toBe(true)
        expect(result.current.layout).toEqual({ explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false })
        // The panes' own settings are left alone.
        expect(app.settings.layout).toEqual({ ...saved, focusMode: true })

        act(() => result.current.setFocusMode(false))
        rerender()
        expect(result.current.focusMode).toBe(false)
        expect(app.settings.layout).toEqual(saved)
        expect(result.current.layout).toEqual({ explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: true })
    })

    it('shows the editor in focus mode even when the saved layout is Preview Only', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, editorOpen: false, previewOpen: true, focusMode: true } }
        const { result } = renderHook(() => useStudioLayout(), { wrapper })

        expect(result.current.layout).toEqual({ explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false })
    })

    it.each([
        ['the explorer', (l: ReturnType<typeof useStudioLayout>) => l.setExplorerOpen(true), { explorerOpen: true }],
        ['the preview', (l: ReturnType<typeof useStudioLayout>) => l.setPreviewOpen(true), { previewOpen: true }],
        ['the Outline panel', (l: ReturnType<typeof useStudioLayout>) => l.setOutlineOpen(true), { outlineOpen: true }],
        ['Preview Only', (l: ReturnType<typeof useStudioLayout>) => l.setPreviewOnly(), { editorOpen: false, previewOpen: true }],
    ])('leaves focus mode when %s is shown', (_, show, expected) => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, explorerOpen: false, previewOpen: false, focusMode: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => show(result.current))
        rerender()

        expect(app.settings.layout).toMatchObject({ focusMode: false, ...expected })
        expect(result.current.focusMode).toBe(false)
        expect(result.current.layout).toMatchObject(expected)
    })

    it('stays in focus mode when the editor is shown, as Find in Workspace and Go to Line do, since it already shows', () => {
        // The palette shows the editor before it moves it to a hit or a line (use-palette-search.ts).
        app.settings = { ...app.settings, layout: { ...app.settings.layout, focusMode: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setEditorOpen(true))
        rerender()

        expect(result.current.focusMode).toBe(true)
        expect(result.current.layout).toEqual({ explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false })
    })

    it('keeps the editor shown for when focus mode ends, when it is shown over a saved Preview Only', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, editorOpen: false, previewOpen: true, focusMode: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setEditorOpen(true))
        rerender()
        expect(result.current.focusMode).toBe(true)

        act(() => result.current.setFocusMode(false))
        rerender()
        expect(result.current.layout).toMatchObject({ editorOpen: true, previewOpen: true })
    })

    it('stays in focus mode when a pane it hides is hidden, and keeps that for when it ends', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, explorerOpen: true, focusMode: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setExplorerOpen(false))
        rerender()
        expect(result.current.focusMode).toBe(true)

        act(() => result.current.setFocusMode(false))
        rerender()
        expect(result.current.layout.explorerOpen).toBe(false)
    })

    it('leaves focus mode when the editor, the one pane it shows, is hidden', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, focusMode: true } }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setEditorOpen(false))
        rerender()

        expect(result.current.focusMode).toBe(false)
        expect(result.current.layout).toMatchObject({ editorOpen: false, previewOpen: true })
    })

    it.each([
        ['Show All Panels', true],
        ['Editor and Preview', false],
    ])('leaves focus mode for %s and shows the editor and the preview, also over a saved Preview Only', (_, sidePanels) => {
        app.settings = {
            ...app.settings,
            layout: { ...app.settings.layout, explorerOpen: false, editorOpen: false, previewOpen: true, focusMode: true },
        }
        const { result, rerender } = renderHook(() => useStudioLayout(), { wrapper })

        // As the layout commands set the panes (layout-commands.ts), in this order.
        act(() => {
            result.current.setExplorerOpen(sidePanels)
            result.current.setEditorOpen(true)
            result.current.setPreviewOpen(true)
            result.current.setOutlineOpen(sidePanels)
        })
        rerender()

        expect(result.current.focusMode).toBe(false)
        expect(result.current.layout).toEqual({ explorerOpen: sidePanels, editorOpen: true, previewOpen: true, outlineOpen: sidePanels })
    })

    it('hides the Outline panel too for Preview Only', () => {
        app.settings = { ...app.settings, layout: { ...app.settings.layout, outlineOpen: true } }
        const { result } = renderHook(() => useStudioLayout(), { wrapper })

        act(() => result.current.setPreviewOnly())

        expect(app.settings.layout).toMatchObject({ explorerOpen: false, editorOpen: false, outlineOpen: false })
    })
})
