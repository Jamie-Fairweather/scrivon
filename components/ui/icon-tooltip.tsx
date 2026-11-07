'use client'

import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The visible label of an icon-only button. Unlike a `title`, it also shows on keyboard focus.
 * A button that can't be used right now should take `aria-disabled` instead of `disabled`,
 * so it can still be focused and hovered to show why.
 */
export function IconTooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
    )
}
