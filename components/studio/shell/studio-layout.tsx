'use client'

import { useCallback, useEffect, useMemo, useRef, type FocusEvent } from 'react'
import { BatchExportProvider } from '@/components/studio/batch-export/batch-export-provider'
import { usePanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import { EditorModelsProvider } from '@/components/studio/editor/editor-models'
import { MarkdownPreviewMemoryProvider } from '@/components/studio/markdown/markdown-expand-context'
import { WorkspaceExplorer } from '@/components/studio/explorer/workspace-explorer'
import { OutlinePanel } from '@/components/studio/outline/outline-panel'
import { PresentModeView } from '@/components/studio/present/present-mode-view'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
import { EditorGroupsView } from '@/components/studio/shell/editor-groups-view'
import { useLeaveFocusModeOnEscape } from '@/components/studio/shell/focus-mode-escape'
import { FOCUSED_GROUP_SELECTOR, focusPane } from '@/components/studio/shell/pane-focus'
import { StudioStatusBar } from '@/components/studio/shell/studio-status-bar'
import type { StudioLayoutState } from '@/lib/workspace/types'
import { useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'

const TAB_BAR = '[data-slot="editor-tab-bar"]'
const CODE_EDITOR = '[data-slot="code-editor"]'

/** Said when focus mode turns on. */
export const FOCUS_MODE_ANNOUNCEMENT = 'Focus mode on. Press Escape to leave.'

/**
 * True when `el` can no longer hold keyboard focus: it is gone from the page or inside the hidden editor, or it
 * is the editor panel itself, which only takes focus in focus mode.
 */
function cannotHoldFocus(el: Element | null, editorHidden: boolean): boolean {
    if (!el || el === document.body || !el.isConnected) return true
    if (el.matches(CODE_EDITOR) && !el.hasAttribute('tabindex')) return true
    return editorHidden && el.closest(CODE_EDITOR) !== null
}

/**
 * Where focus goes when it has nowhere else. In focus mode there is no tab bar: the editor, or the editor's
 * region itself while no file is open. Otherwise the active document tab, or the start of the tab bar: the focused
 * group's, while the editor is split.
 */
function focusFallback(root: HTMLElement | null, focusMode: boolean): void {
    if (focusMode) {
        // The editor, else the editor's region itself while no file is open (pane-focus.ts).
        focusPane('editor')
        return
    }
    const group = root?.querySelector<HTMLElement>(FOCUSED_GROUP_SELECTOR) ?? root
    const target =
        group?.querySelector<HTMLElement>(`${TAB_BAR} [role="tab"][tabindex="0"]`) ??
        group?.querySelector<HTMLElement>(`${TAB_BAR} button:not(:disabled)`)
    target?.focus()
}

/**
 * Closing a tab or hiding a pane can remove or hide the element that had keyboard focus, which
 * drops focus to the page body. When that happens, focus moves to the active document tab, or to
 * the start of the tab bar when no tab is open. In focus mode it moves to the editor. A group that
 * closes (its last tab closed, or Join Groups) counts too.
 */
function useKeepFocusInStudio(tabIds: string, { explorerOpen, editorOpen, previewOpen, outlineOpen }: StudioLayoutState, focusMode: boolean) {
    const rootRef = useRef<HTMLDivElement>(null)
    const lastFocusedRef = useRef<Element | null>(null)

    useEffect(() => {
        if (!lastFocusedRef.current) return
        const editorHidden = !editorOpen
        const frame = requestAnimationFrame(() => {
            if (!cannotHoldFocus(lastFocusedRef.current, editorHidden)) return
            if (!cannotHoldFocus(document.activeElement, editorHidden)) return
            focusFallback(rootRef.current, focusMode)
        })
        return () => cancelAnimationFrame(frame)
    }, [tabIds, explorerOpen, editorOpen, previewOpen, outlineOpen, focusMode])

    // React focus events bubble through portals, so this also sees focus in a tab's context menu.
    const onFocus = (e: FocusEvent) => {
        lastFocusedRef.current = e.target
    }

    return { rootRef, onFocus }
}

export function StudioLayout() {
    const { tabs, groups } = useDocumentTabs()
    const { layout, focusMode, setFocusMode } = useStudioLayout()
    // Which tabs each group shows: a group closing moves focus too, though every tab may still be open.
    const groupLayout = (groups?.groups ?? []).map((g) => `${g.id}:${g.tabIds.join('\n')}`).join('\n\n')
    const { rootRef, onFocus } = useKeepFocusInStudio(`${tabs.map((t) => t.id).join('\n')}\n\n${groupLayout}`, layout, focusMode)
    const leaveFocusMode = useCallback(() => setFocusMode(false), [setFocusMode])
    useLeaveFocusModeOnEscape(focusMode, leaveFocusMode)
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    // Kept here because the canvas below unmounts while a Markdown tab shows. Both groups share each tab's memory.
    const canvasViews = usePanZoomMemory(openTabIds)

    useWindowCloseHandler()

    return (
        <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" onFocus={onFocus}>
            <div className="flex min-h-0 flex-1">
                {/* Export All Diagrams in Folder…, from the explorer's folder menu as well as the File menu and the palette.
                    It also holds whether any export is running, which the tab bar's export below reads. */}
                <BatchExportProvider>
                    {/* Shown whenever it is switched on, at any window width, so the toggles always match the screen. */}
                    {layout.explorerOpen && <WorkspaceExplorer />}
                    {layout.outlineOpen && <OutlinePanel />}

                    {/* Each tab's preview memory (scroll, "Load images"), shared by both groups' previews and the slides. */}
                    <MarkdownPreviewMemoryProvider>
                        {/* The page's one main landmark: the tabs, the editor and the preview, in one or two groups.
                        data-find-overflow-host here and below: the editor's find box tooltips may pass these clips. */}
                        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-find-overflow-host>
                            {/* One buffer per tab, shared by both groups' editors. */}
                            <EditorModelsProvider>
                                <EditorGroupsView canvasViews={canvasViews} />
                            </EditorModelsProvider>
                        </main>
                        {/* Inside the preview's memory, so the slides follow each tab's "Load images" choice. */}
                        <PresentModeView />
                    </MarkdownPreviewMemoryProvider>
                </BatchExportProvider>
            </div>
            {!focusMode && <StudioStatusBar />}
            {/* Always on the page, so a screen reader hears the words when they appear. */}
            <div role="status" aria-live="polite" className="sr-only" data-slot="focus-mode-announcement">
                {focusMode ? FOCUS_MODE_ANNOUNCEMENT : ''}
            </div>
        </div>
    )
}
