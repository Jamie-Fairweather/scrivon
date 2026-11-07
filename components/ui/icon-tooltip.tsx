'use client'

import { useId, type ReactElement, type ReactNode } from 'react'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The visible label of an icon-only button. Unlike a `title`, it also shows on keyboard focus.
 * A button that can't be used right now should take `aria-disabled` instead of `disabled`,
 * so it can still be focused and hovered to show why, and pass that reason as `description`:
 * the tooltip is only seen, so screen readers hear the reason as the button's description.
 */
export function IconTooltip({ label, description, children }: { label: ReactNode; description?: string; children: ReactElement }) {
    const descriptionId = useId()
    return (
        <Tooltip>
            <TooltipTrigger render={children} aria-describedby={description ? descriptionId : undefined} />
            <TooltipPopup>{label}</TooltipPopup>
            {/* Hidden, but still read when the button points to it. */}
            {description ? (
                <span id={descriptionId} hidden>
                    {description}
                </span>
            ) : null}
        </Tooltip>
    )
}
