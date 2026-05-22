'use client'

import { CanvasControlsProvider } from '@/components/studio/canvas-controls-provider'
import { FileExplorer } from '@/components/studio/file-explorer'
import { CodeEditorPanel } from '@/components/studio/code-editor-panel'
import { EditorTabBar } from '@/components/studio/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/use-editor-panel-layout'
import { MermaidCanvas } from '@/components/studio/mermaid-canvas'
import { useSaveShortcut } from '@/components/studio/use-save-shortcut'
import { useWindowCloseHandler } from '@/components/studio/use-window-close'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { useMediaQuery } from '@/hooks/use-media-query'

export function StudioLayout() {
    const { activeTab, layout } = useWorkspace()
    const isMobile = useMediaQuery('(max-width: 768px)')
    const editorLayout = useEditorPanelLayout()

    useWindowCloseHandler()
    useSaveShortcut()

    return (
        <CanvasControlsProvider>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1">
                    {layout.explorerOpen && !isMobile && <FileExplorer />}

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
