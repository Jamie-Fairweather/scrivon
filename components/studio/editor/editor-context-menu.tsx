'use client'

import type { IPosition, editor } from 'monaco-editor'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CommandMenuItem, MenuHint } from '@/components/studio/commands/command-menu-item'
import { useCommands } from '@/components/studio/commands/command-registry'
import { ContextMenuAtPoint, isFocusInMenu, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { MenuGroup, MenuItem, MenuSeparator } from '@/components/ui/menu'
import { runEditorAction } from '@/lib/monaco/editor-actions'
import { listenForEditorContextMenu } from '@/lib/monaco/editor-context-menu'
import type { MisspeltWord } from '@/lib/monaco/spellcheck'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'

/** Monaco's Change All Occurrences, on Ctrl+F2 (Cmd+F2 on a Mac). */
const CHANGE_ALL_ACTION = 'editor.action.changeAll'

/** The word the menu is for, and its suggestions: null until the spell check answers. */
type Spelling = { word: MisspeltWord; suggestions: string[] | null }

function SpellingItems({ spelling: { word, suggestions } }: { spelling: Spelling }) {
    const rows: { label: string; choose?: () => void }[] =
        suggestions === null
            ? [{ label: 'Looking for suggestions…' }]
            : suggestions.length === 0
              ? [{ label: 'No suggestions' }]
              : suggestions.map((suggestion) => ({ label: suggestion, choose: () => word.replaceWith(suggestion) }))
    return (
        <>
            <MenuGroup aria-label={`Suggestions for “${word.word}”`}>
                {rows.map(({ label, choose }, index) => (
                    // Keyed by place, so "Looking for suggestions…" turns into the first suggestion: the same row, and
                    // still the one you are on if you were.
                    <MenuItem key={index} disabled={!choose} onClick={choose}>
                        {label}
                    </MenuItem>
                ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onClick={() => word.addToDictionary()}>Add to Dictionary</MenuItem>
            <MenuSeparator />
        </>
    )
}

type EditorContextMenuProps = {
    /** Null while no file is open. */
    editor: editor.ICodeEditor | null
    readOnly: boolean
    /** The underlined word at a place in the file, or null (also while spell check is off for it). */
    misspeltWordAt: (position: IPosition) => MisspeltWord | null
}

/**
 * The editor's right-click menu, in place of Monaco's own and like the app's other menus. On a misspelt word
 * the dictionary's suggestions come first. The rest are the Edit menu's commands, so they read and work the same.
 */
export function EditorContextMenu({ editor: codeEditor, readOnly, misspeltWordAt }: EditorContextMenuProps) {
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()
    const [spelling, setSpelling] = useState<Spelling | null>(null)
    // Counts each opening and closing, so suggestions for an earlier one are dropped.
    const openingRef = useRef(0)
    // The highlighted row as the menu last said, and whether the arrow keys (not the mouse) put it there.
    const highlightRef = useRef<{ row: HTMLElement | undefined; byKeys: boolean }>({ row: undefined, byKeys: false })
    const misspeltWordAtRef = useRef(misspeltWordAt)
    useEffect(() => {
        misspeltWordAtRef.current = misspeltWordAt
    }, [misspeltWordAt])

    useEffect(() => {
        if (!codeEditor) return
        const listening = listenForEditorContextMenu(codeEditor, ({ point, position }) => {
            const opening = ++openingRef.current
            highlightRef.current = { row: undefined, byKeys: false }
            const word = misspeltWordAtRef.current(position)
            setSpelling(word ? { word, suggestions: null } : null)
            openAt(point)
            void word?.suggestions().then((suggestions) => {
                if (openingRef.current === opening) setSpelling({ word, suggestions })
            })
        })
        return () => listening.dispose()
    }, [codeEditor, openAt])

    // The menu knows its highlighted row only by its place in the list. Suggestions that come while you are already
    // on a row push it down, so the highlight moves to another row while focus stays put. Put them back together
    // before the screen is drawn: after the arrow keys, on the row you were on (focusing it again lets the menu find
    // its new place); after the mouse, on the row now under the mouse.
    const onItemHighlighted = useCallback((row: HTMLElement | undefined, { reason }: { reason: string }) => {
        highlightRef.current = { row, byKeys: reason === 'none' ? highlightRef.current.byKeys : reason === 'keyboard' }
    }, [])
    useLayoutEffect(() => {
        const focused = document.activeElement
        if (!(focused instanceof HTMLElement) || focused.dataset.slot !== 'menu-item') return
        const popup = focused.closest<HTMLElement>('[data-slot="menu-popup"]')
        const { row, byKeys } = highlightRef.current
        if (!popup) return
        if (byKeys) {
            popup.focus({ preventScroll: true })
            focused.focus({ preventScroll: true })
        } else if (row && row !== focused && popup.contains(row)) {
            row.focus({ preventScroll: true })
        }
    }, [spelling])

    const onMenuOpenChange = useCallback(
        (next: boolean) => {
            if (!next) openingRef.current++
            onOpenChange(next)
        },
        [onOpenChange]
    )

    // Esc or a choice gives the editor the keyboard back, unless the choice took it somewhere (the palette).
    const backToEditor = useCallback(() => {
        if (isFocusInMenu()) codeEditor?.focus()
        return false
    }, [codeEditor])

    const commands = useCommands()
    const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])
    const isMac = isMacPlatform()

    return (
        <ContextMenuAtPoint
            open={open}
            onOpenChange={onMenuOpenChange}
            anchor={anchor}
            align="start"
            className="min-w-56"
            finalFocus={backToEditor}
            onItemHighlighted={onItemHighlighted}
        >
            {spelling && <SpellingItems spelling={spelling} />}
            <MenuGroup>
                {!readOnly && <CommandMenuItem command={byId.get('edit.cut')} />}
                <CommandMenuItem command={byId.get('edit.copy')} />
                {!readOnly && <CommandMenuItem command={byId.get('edit.paste')} />}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
                {!readOnly && (
                    <MenuItem onClick={() => codeEditor && runEditorAction(codeEditor, CHANGE_ALL_ACTION)}>
                        Change All Occurrences
                        <MenuHint shortcut={formatChord(isMac ? { key: 'F2', meta: true } : { key: 'F2', ctrl: true }, isMac)} />
                    </MenuItem>
                )}
                <CommandMenuItem command={byId.get('command-palette')} />
            </MenuGroup>
        </ContextMenuAtPoint>
    )
}
