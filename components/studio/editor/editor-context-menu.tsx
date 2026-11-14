'use client'

import type { IPosition, editor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommandMenuItem, MenuHint } from '@/components/studio/commands/command-menu-item'
import { useCommands } from '@/components/studio/commands/command-registry'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
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
    return (
        <>
            <MenuGroup aria-label={`Suggestions for “${word.word}”`}>
                {suggestions === null ? (
                    <MenuItem disabled>Looking for suggestions…</MenuItem>
                ) : suggestions.length === 0 ? (
                    <MenuItem disabled>No suggestions</MenuItem>
                ) : (
                    suggestions.map((suggestion) => (
                        <MenuItem key={suggestion} onClick={() => word.replaceWith(suggestion)}>
                            {suggestion}
                        </MenuItem>
                    ))
                )}
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
    const misspeltWordAtRef = useRef(misspeltWordAt)
    useEffect(() => {
        misspeltWordAtRef.current = misspeltWordAt
    }, [misspeltWordAt])

    useEffect(() => {
        if (!codeEditor) return
        const listening = listenForEditorContextMenu(codeEditor, ({ point, position }) => {
            const opening = ++openingRef.current
            const word = misspeltWordAtRef.current(position)
            setSpelling(word ? { word, suggestions: null } : null)
            openAt(point)
            void word?.suggestions().then((suggestions) => {
                if (openingRef.current === opening) setSpelling({ word, suggestions })
            })
        })
        return () => listening.dispose()
    }, [codeEditor, openAt])

    const onMenuOpenChange = useCallback(
        (next: boolean) => {
            if (!next) openingRef.current++
            onOpenChange(next)
        },
        [onOpenChange]
    )

    // Esc or a choice gives the editor the keyboard back, unless the choice took it somewhere (the palette).
    // This runs as the menu closes, before it leaves the page, so it sees where focus really is.
    const backToEditor = useCallback(() => {
        const active = document.activeElement
        const focusInMenu = !active || active === document.body || active.closest('[data-slot="menu-popup"]') !== null
        if (focusInMenu) codeEditor?.focus()
        return false
    }, [codeEditor])

    const commands = useCommands()
    const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])
    const isMac = isMacPlatform()

    return (
        <ContextMenuAtPoint open={open} onOpenChange={onMenuOpenChange} anchor={anchor} align="start" className="min-w-56" finalFocus={backToEditor}>
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
