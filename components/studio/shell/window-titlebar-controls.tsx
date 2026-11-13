'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useFlushPendingSettings } from '@/components/studio/settings/settings-provider'
import { cn } from '@/lib/utils'
import { useSnapLayouts } from './use-snap-layouts'

/**
 * Keeps the custom title bar above modal dialogs (their backdrop and viewport cover the whole
 * window), so the window can still be dragged, minimised, maximised and closed while one is open.
 * Only raised while a dialog is open, so popovers and tooltips near the top still draw over it.
 * The dialog viewports in components/ui (dialog, alert-dialog, command) start below the title bar
 * so no dialog is hidden under it.
 */
export const TITLEBAR_ABOVE_DIALOGS_CLASS = 'relative [body:has([data-slot$=dialog-popup])_&]:z-60'

/** Menus in the title bar can't be used while a modal dialog is open; show that and ignore clicks. */
export const TITLEBAR_MENUS_BLOCKED_CLASS =
    '[body:has([data-slot$=dialog-popup])_&]:pointer-events-none [body:has([data-slot$=dialog-popup])_&]:opacity-50'

function TitlebarControlButton({
    label,
    onClick,
    className,
    ref,
    hovered,
    children,
}: {
    label: string
    onClick: () => void
    className?: string
    ref?: Ref<HTMLButtonElement>
    /** Hovered as far as Windows knows, when a native window over the button gets the pointer instead. */
    hovered?: boolean
    children: ReactNode
}) {
    return (
        <button
            ref={ref}
            type="button"
            aria-label={label}
            title={label}
            data-hovered={hovered || undefined}
            className={cn(
                `flex h-[var(--titlebar-height)] w-[46px] shrink-0 items-center justify-center text-foreground/80 transition-colors hover:bg-accent/80
                hover:text-foreground data-hovered:bg-accent/80 data-hovered:text-foreground`,
                className
            )}
            onClick={onClick}
        >
            {children}
        </button>
    )
}

export function WindowTitlebarControls() {
    const [maximized, setMaximized] = useState(false)
    const flushPendingSettings = useFlushPendingSettings()
    const maximizeButton = useRef<HTMLButtonElement>(null)
    const maximizeHovered = useSnapLayouts(maximizeButton)

    useEffect(() => {
        const appWindow = getCurrentWindow()
        let unlisten: (() => void) | undefined

        const syncMaximized = () => {
            void appWindow.isMaximized().then(setMaximized)
        }

        syncMaximized()

        void appWindow.onResized(syncMaximized).then((fn) => {
            unlisten = fn
        })

        return () => {
            unlisten?.()
        }
    }, [])

    const minimize = useCallback(() => {
        void getCurrentWindow().minimize()
    }, [])

    const toggleMaximize = useCallback(() => {
        void getCurrentWindow().toggleMaximize()
    }, [])

    const close = useCallback(() => {
        // The window may go without a pagehide, so write a settings change that is still waiting first.
        flushPendingSettings()
        void getCurrentWindow().close()
    }, [flushPendingSettings])

    return (
        <div className="flex h-[var(--titlebar-height)] shrink-0 items-center">
            <TitlebarControlButton label="Minimize" onClick={minimize}>
                <Minus className="size-3.5" strokeWidth={1.5} aria-hidden />
            </TitlebarControlButton>
            <TitlebarControlButton ref={maximizeButton} hovered={maximizeHovered} label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
                {maximized ? <Copy className="size-3" strokeWidth={1.5} aria-hidden /> : <Square className="size-3" strokeWidth={1.5} aria-hidden />}
            </TitlebarControlButton>
            <TitlebarControlButton label="Close" onClick={close} className="hover:bg-[#e81123] hover:text-white">
                <X className="size-4" strokeWidth={1.5} aria-hidden />
            </TitlebarControlButton>
        </div>
    )
}
