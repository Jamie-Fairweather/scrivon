'use client'

import { useEffect, useState, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isWindowsTauri } from '@/lib/tauri/platform'

/** Sent by src-tauri/src/snap_layouts.rs when the pointer moves onto (true) or off (false) the maximise button. */
const HOVER_EVENT = 'maximize-button-hover'

type ButtonArea = { x: number; y: number; width: number; height: number }

/** The button's place on the page in screen pixels: CSS pixels times Windows scaling and zoom. */
function screenArea(rect: DOMRect, scale: number): ButtonArea {
    const x = Math.round(rect.left * scale)
    const y = Math.round(rect.top * scale)
    return { x, y, width: Math.round(rect.right * scale) - x, height: Math.round(rect.bottom * scale) - y }
}

function setArea(area: ButtonArea | null) {
    void invoke('set_maximize_button_area', { area }).catch((err: unknown) => console.warn("Couldn't set up Snap Layouts", err))
}

/**
 * Windows 11 Snap Layouts on the title bar's own maximise button (F42). Windows only shows them over a button
 * it knows is the maximise button, so the app puts an invisible native window over this one
 * (src-tauri/src/snap_layouts.rs). This keeps that window over the button as the window is resized, zoomed or
 * moved to a screen with other scaling. The native window gets the pointer instead of the page, so this
 * returns whether the pointer is over the button, for the hover look. Before Windows 11 nothing changes.
 */
export function useSnapLayouts(button: RefObject<HTMLElement | null>): boolean {
    const [hovered, setHovered] = useState(false)

    useEffect(() => {
        const element = button.current
        if (!element || !isWindowsTauri()) return

        let sent = ''
        const update = () => {
            const area = screenArea(element.getBoundingClientRect(), window.devicePixelRatio)
            const key = JSON.stringify(area)
            if (key === sent) return
            sent = key
            setArea(area)
        }

        // devicePixelRatio has no change event; a media query for the current value tells when it stops matching.
        let scale: MediaQueryList | undefined
        const watchScale = () => {
            scale?.removeEventListener('change', onScaleChange)
            scale = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
            scale.addEventListener('change', onScaleChange)
        }
        const onScaleChange = () => {
            watchScale()
            update()
        }

        update()
        watchScale()
        window.addEventListener('resize', update)
        const resized = new ResizeObserver(update)
        resized.observe(element)

        let gone = false
        let unlisten: (() => void) | undefined
        void getCurrentWindow()
            .listen<boolean>(HOVER_EVENT, (event) => setHovered(event.payload))
            .then((fn) => {
                if (gone) fn()
                else unlisten = fn
            })

        return () => {
            gone = true
            unlisten?.()
            resized.disconnect()
            window.removeEventListener('resize', update)
            scale?.removeEventListener('change', onScaleChange)
            setArea(null)
        }
    }, [button])

    return hovered
}
