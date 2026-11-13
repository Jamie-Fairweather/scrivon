'use client'

import { useEffect, useMemo, useRef, type FocusEvent } from 'react'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { usePanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import { MarkdownDocumentViewer } from '@/components/studio/markdown/markdown-document-viewer'
import { MarkdownExpandProvider } from '@/components/studio/markdown/markdown-expand-context'
import { CodeEditorPanel } from '@/components/studio/editor/code-editor-panel'
import { EditorTabBar } from '@/components/studio/editor/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/editor/use-editor-panel-layout'
import { WorkspaceExplorer } from '@/components/studio/explorer/workspace-explorer'
import { OutlinePanel } from '@/components/studio/outline/outline-panel'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
import { PaneCrashNotice, PaneErrorBoundary } from '@/components/studio/shell/pane-error-boundary'
import { StudioStatusBar } from '@/components/studio/shell/studio-status-bar'
import { documentKind } from '@/lib/workspace/file-types'
import { useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'

const TAB_BAR = '[data-slot="editor-tab-bar"]'
const CODE_EDITOR = '[data-slot="code-editor"]'

/** True when `el` can no longer hold keyboard focus: it is gone from the page or inside the hidden editor. */
function cannotHoldFocus(el: Element | null, editorHidden: boolean): boolean {
    if (!el || el === document.body || !el.isConnected) return true
    return editorHidden && el.closest(CODE_EDITOR) !== null
}

/**
 * Closing a tab or hiding a pane can remove or hide the element that had keyboard focus, which
 * drops focus to the page body. When that happens, focus moves to the active document tab, or to
 * the start of the tab bar when no tab is open.
 */
function useKeepFocusInStudio(tabIds: string, explorerOpen: boolean, editorOpen: boolean, outlineOpen: boolean) {
    const rootRef = useRef<HTMLDivElement>(null)
    const lastFocusedRef = useRef<Element | null>(null)

    useEffect(() => {
        if (!lastFocusedRef.current) return
        const editorHidden = !editorOpen
        const frame = requestAnimationFrame(() => {
            if (!cannotHoldFocus(lastFocusedRef.current, editorHidden)) return
            if (!cannotHoldFocus(document.activeElement, editorHidden)) return
            const root = rootRef.current
            const target =
                root?.querySelector<HTMLElement>(`${TAB_BAR} [role="tab"][tabindex="0"]`) ??
                root?.querySelector<HTMLElement>(`${TAB_BAR} button:not(:disabled)`)
            target?.focus()
        })
        return () => cancelAnimationFrame(frame)
    }, [tabIds, explorerOpen, editorOpen, outlineOpen])

    // React focus events bubble through portals, so this also sees focus in a tab's context menu.
    const onFocus = (e: FocusEvent) => {
        lastFocusedRef.current = e.target
    }

    return { rootRef, onFocus }
}

function viewerCrashNotice(error: Error) {
    return (
        <PaneCrashNotice
            className="min-h-0 min-w-0 flex-1 bg-background"
            title="Couldn't show this document"
            error={error}
            hint="Edit it or switch tabs to try again."
        />
    )
}

export function StudioLayout() {
    const { tabs, activeTab, activeTabId } = useDocumentTabs()
    const { layout } = useStudioLayout()
    const editorLayout = useEditorPanelLayout()
    const { rootRef, onFocus } = useKeepFocusInStudio(tabs.map((t) => t.id).join('\n'), layout.explorerOpen, layout.editorOpen, layout.outlineOpen)
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    // Kept here because the canvas below unmounts while a Markdown tab shows.
    const canvasViews = usePanZoomMemory(openTabIds)

    useWindowCloseHandler()

    const viewerKind = activeTab ? documentKind(activeTab.name) : null

    return (
        <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" onFocus={onFocus}>
            <div className="flex min-h-0 flex-1">
                {/* Shown whenever it is switched on, at any window width, so the toggles always match the screen. */}
                {layout.explorerOpen && <WorkspaceExplorer />}
                {layout.outlineOpen && <OutlinePanel />}

                <MarkdownExpandProvider tabId={activeTabId}>
                    {/* The page's one main landmark: the tabs, the editor and the preview.
                        data-find-overflow-host here and below: the editor's find box tooltips may pass these clips. */}
                    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-find-overflow-host>
                        <EditorTabBar />

                        {/* relative: the hidden editor is laid over this row (see CodeEditorPanel). */}
                        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-find-overflow-host>
                            {/* Hidden rather than unmounted, so hiding the editor keeps its undo history and position. */}
                            {editorLayout.hydrated && (
                                <CodeEditorPanel
                                    open={layout.editorOpen}
                                    width={editorLayout.width}
                                    onWidthChange={editorLayout.onWidthChange}
                                    onResetWidth={editorLayout.resetEditorWidth}
                                />
                            )}

                            {/* A pane of its own for F6 and Focus Preview (pane-focus.ts). It takes focus itself when
                                nothing in it can, such as a diagram. */}
                            <div
                                data-pane="preview"
                                role="region"
                                aria-label="Preview"
                                tabIndex={-1}
                                className="flex min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring
                                    focus-visible:ring-inset"
                            >
                                {/* A view that breaks takes only itself down; the editor and tabs stay usable. */}
                                <PaneErrorBoundary resetKeys={[activeTabId, activeTab?.content]} fallback={viewerCrashNotice}>
                                    {viewerKind === 'markdown' ? (
                                        <MarkdownDocumentViewer source={activeTab?.content ?? ''} tabId={activeTabId} />
                                    ) : (
                                        <MermaidCanvas source={activeTab?.content ?? ''} viewMemory={canvasViews} />
                                    )}
                                </PaneErrorBoundary>
                            </div>
                        </div>
                    </main>
                </MarkdownExpandProvider>
            </div>
            <StudioStatusBar />
        </div>
    )
}
