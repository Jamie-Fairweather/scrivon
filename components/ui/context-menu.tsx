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

/**
 * Whether focus is still in a menu (or nowhere), for a menu's `finalFocus`: as it closes, the menu gives focus back
 * only then, and not when a choice in it has taken focus somewhere else (a prompt or the palette). The menu calls
 * `finalFocus` before it leaves the page, so this sees where focus really is.
 */
export function isFocusInMenu(): boolean {
    const active = document.activeElement
    return !active || active === document.body || active.closest('[data-slot="menu-popup"]') !== null
}

export function ContextMenuAtPoint({
    open,
    onOpenChange,
    anchor,
    children,
    align = 'start',
    side = 'bottom',
    className,
    finalFocus,
    onItemHighlighted,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    anchor: Element | undefined
    children: React.ReactNode
    align?: React.ComponentProps<typeof MenuPopup>['align']
    side?: React.ComponentProps<typeof MenuPopup>['side']
    className?: string
    finalFocus?: React.ComponentProps<typeof MenuPopup>['finalFocus']
    onItemHighlighted?: React.ComponentProps<typeof Menu>['onItemHighlighted']
}) {
    return (
        <Menu open={open} onOpenChange={onOpenChange} onItemHighlighted={onItemHighlighted}>
            <MenuPopup anchor={anchor} align={align} side={side} className={className} finalFocus={finalFocus}>
                {children}
            </MenuPopup>
        </Menu>
    )
}
