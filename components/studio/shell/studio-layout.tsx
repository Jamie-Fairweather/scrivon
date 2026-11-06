'use client'

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

export function StudioLayout() {
    const { activeTab, activeTabId } = useDocumentTabs()
    const { layout } = useStudioLayout()
    const editorLayout = useEditorPanelLayout()

    useWindowCloseHandler()

    const viewerKind = activeTab ? documentKind(activeTab.name) : null

    return (
        <CanvasControlsProvider>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1">
                    {/* Shown whenever it is switched on, at any window width, so the toggles always match the screen. */}
                    {layout.explorerOpen && <WorkspaceExplorer />}

                    <MarkdownExpandProvider tabId={activeTabId}>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            <EditorTabBar />

                            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                                {/* Hidden rather than unmounted, so hiding the editor keeps its undo history and position. */}
                                {editorLayout.hydrated && (
                                    <CodeEditorPanel open={layout.editorOpen} width={editorLayout.width} onWidthChange={editorLayout.onWidthChange} />
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
