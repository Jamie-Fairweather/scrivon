'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { GroupCanvasControlsProvider } from '@/components/studio/canvas/canvas-controls-provider'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import type { LocateInFile } from '@/components/studio/canvas/use-diagram-picking'
import type { PanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import { CodeEditorPanel } from '@/components/studio/editor/code-editor-panel'
import { FocusModeExportMenu } from '@/components/studio/editor/document-export-menu'
import { DocumentExportProvider } from '@/components/studio/editor/document-export-provider'
import { EditorTabBar } from '@/components/studio/editor/editor-tab-bar'
import { useEditorPanelLayout } from '@/components/studio/editor/use-editor-panel-layout'
import { MarkdownDocumentViewer } from '@/components/studio/markdown/markdown-document-viewer'
import { MarkdownExpandProvider } from '@/components/studio/markdown/markdown-expand-context'
import { PaneCrashNotice, PaneErrorBoundary } from '@/components/studio/shell/pane-error-boundary'
import { GroupCanvasFitProvider } from '@/components/studio/workspace/canvas-fit-context'
import { EditorGroupProvider, useEditorGroup } from '@/components/studio/workspace/editor-group-context'
import { useDocumentTabActions, useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { DEFAULT_GROUP_RATIO, leftGroupWidth, leftGroupWidthBounds } from '@/lib/workspace/editor-groups'
import { documentKind } from '@/lib/workspace/file-types'
import { cn } from '@/lib/utils'

/** How far one arrow key press moves the divider between the groups (with Shift: the larger step). */
const KEYBOARD_STEP = 16
const KEYBOARD_BIG_STEP = 64

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

/** One group's tab strip, editor and preview. */
function EditorGroupPane({ canvasViews, width }: { canvasViews: PanZoomMemory; width: number | null }) {
    const { layout, focusMode } = useStudioLayout()
    const editorLayout = useEditorPanelLayout()
    const { focusGroup } = useDocumentTabActions()
    const group = useEditorGroup()
    const { tab, index, count, focused } = group
    const split = count > 1
    const tabId = tab?.id ?? null
    const viewerKind = tab ? documentKind(tab.name) : null
    // A part double-clicked on the diagram is on the same line of the tab's own text.
    const tabPath = tab?.path ?? null
    const locateInTab = useCallback<LocateInFile>((location) => (tabPath ? { path: tabPath, ...location } : null), [tabPath])
    // The group clicked or typed in takes the keyboard: "the current document" everywhere else is its tab.
    const takeFocus = useCallback(() => focusGroup(index), [focusGroup, index])

    return (
        <section
            data-editor-group={group.id}
            // Marks the group with the keyboard for Focus Editor and Focus Preview (pane-focus.ts), while split.
            data-focused-group={split && focused ? '' : undefined}
            aria-label={split ? `Editor, ${group.label}` : undefined}
            className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', width === null ? 'flex-1' : 'shrink-0')}
            style={width === null ? undefined : { width }}
            // The editor's find box tooltips may pass this clip, as the others around the editor.
            data-find-overflow-host
            onFocus={takeFocus}
            onPointerDownCapture={takeFocus}
        >
            {/* The focused group has a bar along its top, so it shows by shape as well as colour (and in contrast themes). */}
            {split ? (
                <span
                    aria-hidden
                    data-slot="focused-group-bar"
                    className={cn(
                        'pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5',
                        focused ? 'bg-ring forced-colors:bg-[Highlight]' : 'bg-transparent'
                    )}
                />
            ) : null}
            <MarkdownExpandProvider tabId={tabId}>
                <GroupCanvasFitProvider focused={focused}>
                    <GroupCanvasControlsProvider focused={focused}>
                        {/* Export for the group's tab, from its strip; the File menu, the palette and the shortcut use the
                            focused group's. Mounted in focus mode too, without the strip, so exporting still works. */}
                        <DocumentExportProvider registerCommands={focused}>
                            {focusMode ? <FocusModeExportMenu /> : <EditorTabBar />}
                        </DocumentExportProvider>

                        {/* relative: the hidden editor is laid over this row (see CodeEditorPanel). */}
                        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-find-overflow-host>
                            {/* Hidden rather than unmounted, so hiding the editor keeps its undo history and position.
                                Focus mode only changes what it is given, so it keeps them too. */}
                            {editorLayout.hydrated && (
                                <CodeEditorPanel
                                    open={layout.editorOpen}
                                    fill={!layout.previewOpen}
                                    focusMode={focusMode}
                                    width={editorLayout.width}
                                    onWidthChange={editorLayout.onWidthChange}
                                    onResetWidth={editorLayout.resetEditorWidth}
                                />
                            )}

                            {/* A pane of its own for F6 and Focus Preview (pane-focus.ts). They go to the diagram canvas,
                                else its scroll box when it scrolls, else this region itself. Unmounted while hidden, so it
                                doesn't draw on every keystroke. */}
                            {layout.previewOpen && (
                                <div
                                    data-pane="preview"
                                    role="region"
                                    aria-label={split ? `Preview, ${group.label}` : 'Preview'}
                                    tabIndex={-1}
                                    className="flex min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring
                                        focus-visible:ring-inset"
                                >
                                    {/* A view that breaks takes only itself down; the editor and tabs stay usable. */}
                                    <PaneErrorBoundary resetKeys={[tabId, tab?.content]} fallback={viewerCrashNotice}>
                                        {viewerKind === 'markdown' ? (
                                            <MarkdownDocumentViewer source={tab?.content ?? ''} tabId={tabId} />
                                        ) : (
                                            <MermaidCanvas
                                                source={tab?.content ?? ''}
                                                viewMemory={canvasViews}
                                                locateInFile={locateInTab}
                                                partsInPalette
                                            />
                                        )}
                                    </PaneErrorBoundary>
                                </div>
                            )}
                        </div>
                    </GroupCanvasControlsProvider>
                </GroupCanvasFitProvider>
            </MarkdownExpandProvider>
        </section>
    )
}

/** The divider's width in pixels (its w-px class), taken from the room the two groups share. */
const GROUP_DIVIDER_WIDTH = 1

/**
 * The divider between the two groups: dragged, or moved with the arrow keys (Shift for bigger steps), Home and End
 * for the narrowest and widest, Enter or a double-click to share the room evenly again. Each group stays at least
 * MIN_GROUP_WIDTH wide.
 */
function GroupDivider({
    total,
    leftWidth,
    onDrag,
    onChange,
}: {
    /** The room both groups share: the row less the divider. */
    total: number
    leftWidth: number
    onDrag: (width: number | null) => void
    onChange: (width: number) => void
}) {
    const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)
    const { min, max } = leftGroupWidthBounds(total)
    const clamp = (width: number) => Math.round(Math.min(max, Math.max(min, width)))

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        // Only the main button drags; right and middle clicks do nothing here.
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: leftWidth, width: leftWidth }
        onDrag(leftWidth)
    }
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || e.pointerId !== drag.pointerId) return
        drag.width = clamp(drag.startWidth + e.clientX - drag.startX)
        onDrag(drag.width)
    }
    /** Ends a drag however it ends (release, cancel or lost capture) and keeps the place once. */
    const endDrag = () => {
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        onDrag(null)
        if (drag.width !== drag.startWidth) onChange(drag.width)
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? KEYBOARD_BIG_STEP : KEYBOARD_STEP
        let next: number
        if (e.key === 'ArrowLeft') next = leftWidth - step
        else if (e.key === 'ArrowRight') next = leftWidth + step
        else if (e.key === 'Home') next = min
        else if (e.key === 'End') next = max
        else if (e.key === 'Enter') next = total * DEFAULT_GROUP_RATIO
        else return
        e.preventDefault()
        const clamped = clamp(next)
        if (clamped !== leftWidth) onChange(clamped)
    }

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor groups"
            aria-valuenow={leftWidth}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={`Left group ${leftWidth} pixels wide`}
            tabIndex={0}
            data-slot="editor-group-divider"
            className="relative z-20 w-px shrink-0 cursor-col-resize touch-none bg-border outline-none before:absolute before:inset-y-0
                before:-right-1 before:-left-1 before:content-[''] hover:bg-ring/50 focus-visible:bg-ring active:bg-ring/60
                forced-colors:bg-[CanvasText]"
            onKeyDown={onKeyDown}
            onDoubleClick={() => onChange(clamp(total * DEFAULT_GROUP_RATIO))}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
        />
    )
}

/**
 * The editor area: one group, or two side by side with a divider between them. Each group has its own tab strip,
 * editor and preview; the tabs themselves are shared (DocumentTabsProvider).
 */
export function EditorGroupsView({ canvasViews }: { canvasViews: PanZoomMemory }) {
    const { groups } = useDocumentTabs()
    const { setGroupRatio } = useDocumentTabActions()
    const rowRef = useRef<HTMLDivElement>(null)
    const [total, setTotal] = useState(0)
    const [dragWidth, setDragWidth] = useState<number | null>(null)
    const split = groups.groups.length > 1

    // The room both groups share, so each can be kept at its minimum and nothing scrolls sideways.
    useEffect(() => {
        const row = rowRef.current
        if (!row || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setTotal(entry.contentRect.width)
        })
        observer.observe(row)
        return () => observer.disconnect()
    }, [])

    const measured = total > 0 ? total : typeof window !== 'undefined' ? window.innerWidth : 0
    // The groups share what the divider leaves, so the right group (the rest of the row) is never under its minimum.
    const room = split ? Math.max(0, measured - GROUP_DIVIDER_WIDTH) : measured
    const leftWidth = dragWidth ?? leftGroupWidth(groups.ratio, room)
    const onChange = useCallback((width: number) => setGroupRatio(room > 0 ? width / room : DEFAULT_GROUP_RATIO), [room, setGroupRatio])

    return (
        <div ref={rowRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-find-overflow-host data-slot="editor-groups">
            {groups.groups.map((group, index) => (
                <EditorGroupProvider key={group.id} index={index}>
                    {index === 1 ? <GroupDivider total={room} leftWidth={leftWidth} onDrag={setDragWidth} onChange={onChange} /> : null}
                    <EditorGroupPane canvasViews={canvasViews} width={split && index === 0 ? leftWidth : null} />
                </EditorGroupProvider>
            ))}
        </div>
    )
}
