'use client'

import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isWindowsTauri } from '@/lib/tauri/platform'

/** Input types that hold text the user can cut, copy, paste and spell-check. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number'])

/** Text fields keep the system menu: Cut, Copy, Paste and spelling suggestions. */
function isTextField(target: Element): boolean {
    if (target instanceof HTMLElement && target.isContentEditable) return true
    if (target instanceof HTMLTextAreaElement) return true
    return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)
}

/**
 * The empty part of the app's own title bars, which the window is dragged by (Tauri's drag region: only the
 * element marked, not what is inside it).
 */
function isTitleBarDragArea(target: Element): boolean {
    const region = target.getAttribute('data-tauri-drag-region')
    return region !== null && region !== 'false'
}

/** A right-click on selected text (in the Markdown preview, say) keeps the system menu, for its Copy. */
function isOnSelectedText(target: Element): boolean {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return false
    for (let i = 0; i < selection.rangeCount; i++) {
        if (selection.getRangeAt(i).intersectsNode(target)) return true
    }
    return false
}

/**
 * Turns off the webview's own right-click menu (Back, Reload, Save as, Print), which has nothing for this app,
 * except in text fields and on selected text. The app's own menus, such as the file tree's and the editor's,
 * still open: they replace the native one themselves. On Windows, the title bar gets the window menu instead
 * (Restore, Move, Size, Minimize, Maximize, Close), as on a title bar Windows draws itself.
 */
export function DisableNativeContextMenu() {
    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            const target = e.target
            if (target instanceof Element && isTitleBarDragArea(target)) {
                e.preventDefault()
                if (isWindowsTauri()) void invoke('show_system_menu').catch((err: unknown) => console.warn("Couldn't show the window menu", err))
                return
            }
            if (target instanceof Element && (isTextField(target) || isOnSelectedText(target))) return
            e.preventDefault()
        }

        window.addEventListener('contextmenu', onContextMenu, { capture: true })
        return () => window.removeEventListener('contextmenu', onContextMenu, { capture: true })
    }, [])

    return null
}
