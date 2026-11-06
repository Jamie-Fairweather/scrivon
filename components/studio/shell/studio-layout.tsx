'use client'

import { useEffect, useRef, type FocusEvent } from 'react'
import { CanvasControlsProvider } from '@/components/studio/canvas/canvas-controls-provider'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { MarkdownDocumentViewer } from '@/components/studio/markdown/markdown-document-viewer'
import { MarkdownExpandProvider } from '@/components/studio/markdown/markdown-expand-context'
import { CodeEditorPanel } from '@/components/studio/editor/code-editor-panel'
import { EditorTabBar } from '@/components/studio/editor/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/editor/use-editor-panel-layout'
import { WorkspaceExplorer } from '@/components/studio/explorer/workspace-explorer'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
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
function useKeepFocusInStudio(tabIds: string, explorerOpen: boolean, editorOpen: boolean) {
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
    }, [tabIds, explorerOpen, editorOpen])

    // React focus events bubble through portals, so this also sees focus in a tab's context menu.
    const onFocus = (e: FocusEvent) => {
        lastFocusedRef.current = e.target
    }

    return { rootRef, onFocus }
}

export function StudioLayout() {
    const { tabs, activeTab, activeTabId } = useDocumentTabs()
    const { layout } = useStudioLayout()
    const editorLayout = useEditorPanelLayout()
    const { rootRef, onFocus } = useKeepFocusInStudio(tabs.map((t) => t.id).join('\n'), layout.explorerOpen, layout.editorOpen)

    useWindowCloseHandler()

    const viewerKind = activeTab ? documentKind(activeTab.name) : null

    return (
        <CanvasControlsProvider>
            <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" onFocus={onFocus}>
                <div className="flex min-h-0 flex-1">
                    {/* Shown whenever it is switched on, at any window width, so the toggles always match the screen. */}
                    {layout.explorerOpen && <WorkspaceExplorer />}

                    <MarkdownExpandProvider tabId={activeTabId}>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            <EditorTabBar />

                            {/* relative: the hidden editor is laid over this row (see CodeEditorPanel). */}
                            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                                {/* Hidden rather than unmounted, so hiding the editor keeps its undo history and position. */}
                                {editorLayout.hydrated && (
                                    <CodeEditorPanel
                                        open={layout.editorOpen}
                                        width={editorLayout.width}
                                        onWidthChange={editorLayout.onWidthChange}
                                        onResetWidth={editorLayout.resetEditorWidth}
                                    />
                                )}

                                {viewerKind === 'markdown' ? (
                                    <MarkdownDocumentViewer source={activeTab?.content ?? ''} tabId={activeTabId} />
                                ) : (
                                    <MermaidCanvas source={activeTab?.content ?? ''} />
                                )}
                            </div>
                        </div>
                    </MarkdownExpandProvider>
                </div>
            </div>
        </CanvasControlsProvider>
    )
}
