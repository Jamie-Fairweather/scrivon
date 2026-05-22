'use client'

import { CanvasControlsProvider } from '@/components/studio/canvas/canvas-controls-provider'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { CodeEditorPanel } from '@/components/studio/editor/code-editor-panel'
import { EditorTabBar } from '@/components/studio/editor/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/editor/use-editor-panel-layout'
import { WorkspaceExplorer } from '@/components/studio/explorer/workspace-explorer'
import { useSaveShortcut } from '@/components/studio/hooks/use-save-shortcut'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
import { useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { useMediaQuery } from '@/hooks/use-media-query'

export function StudioLayout() {
    const { activeTab } = useDocumentTabs()
    const { layout } = useStudioLayout()
    const isMobile = useMediaQuery('(max-width: 768px)')
    const editorLayout = useEditorPanelLayout()

    useWindowCloseHandler()
    useSaveShortcut()

    return (
        <CanvasControlsProvider>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1">
                    {layout.explorerOpen && !isMobile && <WorkspaceExplorer />}

                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        <EditorTabBar />

                        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                            {layout.editorOpen && editorLayout.hydrated && (
                                <CodeEditorPanel width={editorLayout.width} onWidthChange={editorLayout.onWidthChange} />
                            )}

                            <MermaidCanvas source={activeTab?.content ?? ''} />
                        </div>
                    </div>
                </div>
            </div>
        </CanvasControlsProvider>
    )
}
