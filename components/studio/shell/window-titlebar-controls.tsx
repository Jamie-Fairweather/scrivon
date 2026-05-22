'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '@/lib/utils'

function TitlebarControlButton({
    label,
    onClick,
    className,
    children,
}: {
    label: string
    onClick: () => void
    className?: string
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
                `flex h-[var(--titlebar-height)] w-[46px] shrink-0 items-center justify-center text-foreground/80 transition-colors hover:bg-accent/80
                hover:text-foreground`,
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
        void getCurrentWindow().close()
    }, [])

    return (
        <div className="flex h-[var(--titlebar-height)] shrink-0 items-center">
            <TitlebarControlButton label="Minimize" onClick={minimize}>
                <Minus className="size-3.5" strokeWidth={1.5} aria-hidden />
            </TitlebarControlButton>
            <TitlebarControlButton label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
                {maximized ? <Copy className="size-3" strokeWidth={1.5} aria-hidden /> : <Square className="size-3" strokeWidth={1.5} aria-hidden />}
            </TitlebarControlButton>
            <TitlebarControlButton label="Close" onClick={close} className="hover:bg-[#e81123] hover:text-white">
                <X className="size-4" strokeWidth={1.5} aria-hidden />
            </TitlebarControlButton>
        </div>
    )
}
