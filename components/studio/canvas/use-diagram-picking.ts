'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { PanZoomState } from '@/components/studio/canvas/use-pan-zoom'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useStudioLayout, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { pickDiagramTarget, readDiagramTargets, targetOutlinePath, type DiagramTarget, type Point } from '@/lib/mermaid/diagram-targets'
import { locateDiagramTarget, type SourceLocation } from '@/lib/mermaid/source-locations'

/** A place in a file for the editor to select: its path, line and column from 1, and how many characters. */
export type EditorPlace = { path: string; line: number; column: number; length: number }

/**
 * Turns a place in the diagram's text into one in the host's file: a `.mmd` tab's own lines, or a Markdown file's
 * lines below the block's fence. Null when it can't (the block is no longer in the preview, say).
 */
export type LocateInFile = (location: SourceLocation) => EditorPlace | null

type PanHandlers = {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
}

type DiagramPickingOptions = {
    containerRef: RefObject<HTMLElement | null>
    getView: () => PanZoomState
    /** The SVG of the picture on screen (DiagramIframe's onShownSvg), or null while none shows. */
    shownSvg: string | null
    /** The diagram's text as the editor holds it, untrimmed. */
    source: string
    locateInFile?: LocateInFile
    panHandlers: PanHandlers
    /** What a double-click does when it doesn't jump: puts the view back to 100%. */
    reset: () => void
}

/**
 * Double-click a part of the diagram (a node, link, subgraph, state, participant or message) to select its text in
 * the editor. The picture is drawn in a sandboxed frame the app can't look into, so parts are found from the SVG
 * string (diagram-targets.ts) and the pointer's place in the pan and zoom. While a jump would happen, the pointer
 * changes over a part and an outline shows it, worked out at most once an animation frame.
 *
 * The jump only happens while the editor shows and "Double-click the preview to jump to the editor" is on, both
 * read at the moment of the double-click. Otherwise a double-click resets the view, as on empty canvas: the editor
 * keeps a jump asked for while it is hidden and makes it when next shown, which would move the cursor and take the
 * keyboard then.
 */
export function useDiagramPicking({ containerRef, getView, shownSvg, source, locateInFile, panHandlers, reset }: DiagramPickingOptions) {
    const { layout } = useStudioLayout()
    const { settings } = useAppSettings()
    const coordinator = useWorkspaceCoordinator()
    const canJump = Boolean(locateInFile) && layout.editorOpen && settings.editor.jumpFromPreview
    const diagram = useMemo(() => (shownSvg ? readDiagramTargets(shownSvg) : null), [shownSvg])

    const latestRef = useRef({ canJump, diagram, source, locateInFile })
    useLayoutEffect(() => {
        latestRef.current = { canJump, diagram, source, locateInFile }
    })

    const outlineRef = useRef<SVGPathElement>(null)
    const hoveredRef = useRef<DiagramTarget | null>(null)
    const pointRef = useRef<Point | null>(null)
    const frameRef = useRef(0)

    const pick = useCallback(
        (point: Point): DiagramTarget | null => {
            const container = containerRef.current
            const shown = latestRef.current.diagram
            if (!container || !shown) return null
            return pickDiagramTarget(shown, point, container.getBoundingClientRect(), getView())
        },
        [containerRef, getView]
    )

    const showHover = useCallback(
        (target: DiagramTarget | null) => {
            const container = containerRef.current
            // An inline cursor, so the pan's grab and grabbing classes take over again as soon as it is cleared.
            if (container) container.style.cursor = target ? 'pointer' : ''
            if (hoveredRef.current === target) return
            hoveredRef.current = target
            outlineRef.current?.setAttribute('d', target ? targetOutlinePath(target) : '')
        },
        [containerRef]
    )

    const stopHover = useCallback(() => {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
        pointRef.current = null
        showHover(null)
    }, [showHover])

    // A new picture, or a jump no longer possible: whatever was outlined is gone.
    useEffect(() => stopHover(), [diagram, canJump, stopHover])
    useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            panHandlers.onPointerMove(e)
            if (!latestRef.current.canJump || e.buttons !== 0) {
                // Dragging pans the diagram: no outline while it moves.
                if (hoveredRef.current || pointRef.current) stopHover()
                return
            }
            pointRef.current = { x: e.clientX, y: e.clientY }
            if (frameRef.current) return
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = 0
                const point = pointRef.current
                showHover(point ? pick(point) : null)
            })
        },
        [panHandlers, pick, showHover, stopHover]
    )

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            // A drag from a part pans, with the grab cursor. The outline stays until the pointer moves.
            const container = containerRef.current
            if (container) container.style.cursor = ''
            panHandlers.onPointerDown(e)
        },
        [containerRef, panHandlers]
    )

    const onDoubleClick = useCallback(
        (e: React.MouseEvent) => {
            const { canJump: jumpNow, source: text, locateInFile: locate } = latestRef.current
            const target = jumpNow && locate ? pick({ x: e.clientX, y: e.clientY }) : null
            if (!target || !locate) return reset()
            // A part the text no longer has (the picture is from before an error, say) does nothing.
            const location = locateDiagramTarget(text, target)
            const place = location ? locate(location) : null
            if (place) coordinator.revealInEditor.current(place.path, place.line, place.column, place.length)
        },
        [pick, reset, coordinator]
    )

    return { outlineRef, handlers: { onPointerMove, onPointerDown, onPointerLeave: stopHover, onDoubleClick } }
}
