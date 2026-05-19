'use client'

import { FileExplorer } from '@/components/studio/file-explorer'
import { CodeEditorPanel } from '@/components/studio/code-editor-panel'
import { EditorTabBar } from '@/components/studio/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/use-editor-panel-layout'
import { MermaidCanvas } from '@/components/studio/mermaid-canvas'
import { StudioToolbar } from '@/components/studio/studio-toolbar'
import { useWindowCloseHandler } from '@/components/studio/use-window-close'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { useMediaQuery } from '@/hooks/use-media-query'

export function StudioLayout() {
    const { activeTab, layout, tabs } = useWorkspace()
    const isMobile = useMediaQuery('(max-width: 768px)')
    const editorLayout = useEditorPanelLayout()

    useWindowCloseHandler()

    const hasTabs = tabs.length > 0

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
            <StudioToolbar />

            <div className="flex min-h-0 flex-1">
                {layout.explorerOpen && !isMobile && <FileExplorer />}

                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {hasTabs && <EditorTabBar />}

                    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        {layout.editorOpen && editorLayout.hydrated && (
                            <CodeEditorPanel
                                width={editorLayout.width}
                                collapsed={editorLayout.collapsed}
                                onWidthChange={editorLayout.onWidthChange}
                                onCollapsedChange={editorLayout.onCollapsedChange}
                            />
                        )}

                        <MermaidCanvas source={activeTab?.content ?? ''} />
                    </div>
                </div>
            </div>
        </div>
    )
}
