'use client'

import { useCallback, useMemo, useState } from 'react'
import { Menu, MenuPopup } from '@/components/ui/menu'

type Point = { x: number; y: number }

function pointAnchor(point: Point) {
    // Base UI positioner supports an "anchor" object that provides a bounding rect.
    // We provide a virtual element at the mouse coordinates.
    return {
        getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
    } as unknown as Element
}

export type UseContextMenuAtPointResult = {
    open: boolean
    anchor: Element | undefined
    openAt: (point: Point) => void
    close: () => void
    onOpenChange: (next: boolean) => void
}

export function useContextMenuAtPoint(): UseContextMenuAtPointResult {
    const [open, setOpen] = useState(false)
    const [point, setPoint] = useState<Point | null>(null)

    const anchor = useMemo(() => (point ? pointAnchor(point) : undefined), [point])

    const openAt = useCallback((p: Point) => {
        setPoint(p)
        setOpen(true)
    }, [])

    const close = useCallback(() => setOpen(false), [])

    const onOpenChange = useCallback((next: boolean) => setOpen(next), [])

    return { open, anchor, openAt, close, onOpenChange }
}

export function ContextMenuAtPoint({
    open,
    onOpenChange,
    anchor,
    children,
    align = 'start',
    side = 'bottom',
    className,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    anchor: Element | undefined
    children: React.ReactNode
    align?: React.ComponentProps<typeof MenuPopup>['align']
    side?: React.ComponentProps<typeof MenuPopup>['side']
    className?: string
}) {
    return (
        <Menu open={open} onOpenChange={onOpenChange}>
            <MenuPopup anchor={anchor} align={align} side={side} className={className}>
                {children}
            </MenuPopup>
        </Menu>
    )
}
