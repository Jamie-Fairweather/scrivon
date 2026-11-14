import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { matchKeybind } from '@/lib/settings/match-keybind'

type KeyOptions = {
    ctrl?: boolean
    meta?: boolean
    shift?: boolean
    alt?: boolean
    code?: string
    /** AltGr held, or Ctrl+Alt on a layout that has AltGr. */
    altGraph?: boolean
    isComposing?: boolean
    keyCode?: number
}

function keyEvent(
    key: string,
    modifiers: KeyOptions = {},
    target: EventTarget | null = { tagName: 'BODY' } as unknown as EventTarget
): KeyboardEvent {
    return {
        key,
        code: modifiers.code,
        ctrlKey: modifiers.ctrl ?? false,
        metaKey: modifiers.meta ?? false,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false,
        isComposing: modifiers.isComposing ?? false,
        keyCode: modifiers.keyCode ?? 0,
        getModifierState: (name: string) => name === 'AltGraph' && Boolean(modifiers.altGraph),
        repeat: false,
        target,
    } as unknown as KeyboardEvent
}

describe('matchKeybind', () => {
    const bindings = createDefaultKeybinds(false)

    it('matches F1 for palette.open', () => {
        expect(matchKeybind(keyEvent('F1'), bindings)).toBe('palette.open')
    })

    it('matches Ctrl+S for document.save', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true }), bindings)).toBe('document.save')
    })

    it('matches Ctrl+Shift+S for workspace.saveAll when workspace is open', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true, shift: true }), bindings, { hasWorkspace: true })).toBe('workspace.saveAll')
    })

    it('matches Ctrl+B for view.toggleExplorer when workspace is open', () => {
        expect(matchKeybind(keyEvent('b', { ctrl: true }), bindings, { hasWorkspace: true })).toBe('view.toggleExplorer')
    })

    it('matches Ctrl+N for a new document and Ctrl+Alt+N for a new diagram, also in the editor, only with a folder open', () => {
        const inEditor = { tagName: 'DIV', closest: (selector: string) => (selector === '.monaco-editor' ? {} : null) } as unknown as EventTarget
        expect(matchKeybind(keyEvent('n', { ctrl: true }, inEditor), bindings, { hasWorkspace: true })).toBe('workspace.newDocument')
        expect(matchKeybind(keyEvent('n', { ctrl: true, alt: true }), bindings, { hasWorkspace: true })).toBe('workspace.newDiagram')
        expect(matchKeybind(keyEvent('n', { ctrl: true }), bindings)).toBeNull()
        // New Folder has no keys until the user picks some.
        expect(bindings['workspace.newFolder']).toEqual([])
    })

    it('matches Ctrl+Alt+P for view.togglePreview when workspace is open, also on a layout with AltGr', () => {
        expect(matchKeybind(keyEvent('p', { ctrl: true, alt: true }), bindings, { hasWorkspace: true })).toBe('view.togglePreview')
        const german = keyEvent('p', { ctrl: true, alt: true, altGraph: true, code: 'KeyP' })
        expect(matchKeybind(german, bindings, { hasWorkspace: true })).toBe('view.togglePreview')
    })

    it('matches Cmd+S on mac defaults', () => {
        const macBindings = createDefaultKeybinds(true)
        expect(matchKeybind(keyEvent('s', { meta: true }), macBindings)).toBe('document.save')
    })

    it('skips save in native text fields', () => {
        const input = { tagName: 'INPUT' } as HTMLElement
        expect(matchKeybind(keyEvent('s', { ctrl: true }, input), bindings)).toBeNull()
    })

    it('allows F1 in native text fields', () => {
        const input = { tagName: 'INPUT' } as HTMLElement
        expect(matchKeybind(keyEvent('F1', {}, input), bindings)).toBe('palette.open')
    })

    it('skips workspace actions without workspace', () => {
        const withShortcut = {
            ...bindings,
            'view.toggleExplorer': [{ key: 'e', ctrl: true }],
        }
        expect(matchKeybind(keyEvent('e', { ctrl: true }), withShortcut, { hasWorkspace: false })).toBeNull()
        expect(matchKeybind(keyEvent('e', { ctrl: true }), withShortcut, { hasWorkspace: true })).toBe('view.toggleExplorer')
    })

    it('ignores repeated key events', () => {
        const event = keyEvent('F1')
        Object.defineProperty(event, 'repeat', { value: true })
        expect(matchKeybind(event, bindings)).toBeNull()
    })

    it('ignores actions with no assigned chords', () => {
        const emptySaveAll = {
            ...bindings,
            'workspace.saveAll': [],
        }
        expect(matchKeybind(keyEvent('s', { ctrl: true, shift: true }), emptySaveAll, { hasWorkspace: true })).toBeNull()
    })

    describe('on other keyboard layouts', () => {
        it('matches Ctrl+S on a Russian layout by the physical key', () => {
            expect(matchKeybind(keyEvent('ы', { ctrl: true, code: 'KeyS' }), bindings)).toBe('document.save')
            expect(matchKeybind(keyEvent('Ы', { ctrl: true, shift: true, code: 'KeyS' }), bindings, { hasWorkspace: true })).toBe('workspace.saveAll')
        })

        it('matches Ctrl+, on a Russian layout, where that key types б', () => {
            expect(matchKeybind(keyEvent('б', { ctrl: true, code: 'Comma' }), bindings)).toBe('settings.open')
        })

        it('matches Ctrl+Shift+1 against a stored 1 and an older stored !', () => {
            const withDigit = { ...bindings, 'view.fitDiagram': [{ key: '1', ctrl: true, shift: true }] }
            const withSymbol = { ...bindings, 'view.fitDiagram': [{ key: '!', ctrl: true, shift: true }] }
            const event = keyEvent('!', { ctrl: true, shift: true, code: 'Digit1' })

            expect(matchKeybind(event, withDigit, { hasWorkspace: true })).toBe('view.fitDiagram')
            expect(matchKeybind(event, withSymbol, { hasWorkspace: true })).toBe('view.fitDiagram')
        })

        it('follows the printed letter on Latin layouts like Dvorak', () => {
            // Dvorak puts "o" where QWERTY has "s"; Ctrl+O must not save.
            expect(matchKeybind(keyEvent('o', { ctrl: true, code: 'KeyS' }), bindings)).toBeNull()
            expect(matchKeybind(keyEvent('s', { ctrl: true, code: 'Semicolon' }), bindings)).toBe('document.save')
        })
    })

    describe('with AltGr, input methods and dead keys', () => {
        const editorTarget = { tagName: 'DIV', closest: (selector: string) => (selector === '.monaco-editor' ? {} : null) } as unknown as EventTarget

        it('never fires on a character typed with AltGr, so it still gets typed', () => {
            // Polish AltGr+E types ę and German AltGr+Q types @; Windows reports both as Ctrl+Alt.
            const withAltGrChords = {
                ...bindings,
                'view.toggleExplorer': [{ key: 'ę', ctrl: true, alt: true }],
                'view.toggleEditor': [{ key: '@', ctrl: true, alt: true }],
            }
            const polish = keyEvent('ę', { ctrl: true, alt: true, altGraph: true, code: 'KeyE' }, editorTarget)
            const german = keyEvent('@', { ctrl: true, alt: true, altGraph: true, code: 'KeyQ' }, editorTarget)

            expect(matchKeybind(polish, withAltGrChords, { hasWorkspace: true })).toBeNull()
            expect(matchKeybind(german, withAltGrChords, { hasWorkspace: true })).toBeNull()
        })

        it('still fires Ctrl+Alt shortcuts on keys that type nothing with AltGr', () => {
            const withCtrlAlt = { ...bindings, 'view.toggleExplorer': [{ key: 't', ctrl: true, alt: true }] }
            const event = keyEvent('t', { ctrl: true, alt: true, altGraph: true, code: 'KeyT' }, editorTarget)
            expect(matchKeybind(event, withCtrlAlt, { hasWorkspace: true })).toBe('view.toggleExplorer')
        })

        it('fires a Ctrl+Alt shortcut on a non-Latin layout that reports Ctrl+Alt as AltGr', () => {
            // Recorded as Ctrl+Alt+S on an English layout, pressed on a Russian one.
            const withCtrlAlt = { ...bindings, 'view.toggleExplorer': [{ key: 's', ctrl: true, alt: true }] }
            const russian = keyEvent('ы', { ctrl: true, alt: true, altGraph: true, code: 'KeyS' }, editorTarget)
            expect(matchKeybind(russian, withCtrlAlt, { hasWorkspace: true })).toBe('view.toggleExplorer')
        })

        it('fires the diagram zoom defaults on plain Alt, which AltGr keyboards like UK and German leave alone', () => {
            // Left Alt is never AltGr, so these work on every layout that has the key.
            expect(matchKeybind(keyEvent('=', { code: 'Equal', alt: true }, editorTarget), bindings, { hasWorkspace: true })).toBe(
                'view.zoomDiagramIn'
            )
            expect(matchKeybind(keyEvent('-', { code: 'Minus', alt: true }, editorTarget), bindings, { hasWorkspace: true })).toBe(
                'view.zoomDiagramOut'
            )
            expect(matchKeybind(keyEvent('0', { code: 'Digit0', alt: true }, editorTarget), bindings, { hasWorkspace: true })).toBe(
                'view.resetDiagramZoom'
            )
            // German has - where US has /.
            expect(matchKeybind(keyEvent('-', { code: 'Slash', alt: true }, editorTarget), bindings, { hasWorkspace: true })).toBe(
                'view.zoomDiagramOut'
            )
            // AltGr (Ctrl+Alt) with the same keys is still left for typing.
            for (const [key, code] of [
                ['=', 'Equal'],
                ['-', 'Minus'],
                ['0', 'Digit0'],
            ]) {
                const altGr = keyEvent(key, { code, ctrl: true, alt: true, altGraph: true }, editorTarget)
                expect(matchKeybind(altGr, bindings, { hasWorkspace: true })).toBeNull()
            }
        })

        it('leaves Alt with a number-pad digit for Alt codes (Alt+0233 types é)', () => {
            expect(matchKeybind(keyEvent('0', { code: 'Numpad0', alt: true }, editorTarget), bindings, { hasWorkspace: true })).toBeNull()
        })

        it('never fires on AltGr or a lock key on its own', () => {
            const withJunk = {
                ...bindings,
                'view.toggleExplorer': [{ key: 'AltGraph', ctrl: true, alt: true }],
                'view.toggleEditor': [{ key: 'CapsLock' }],
            }
            expect(matchKeybind(keyEvent('AltGraph', { ctrl: true, alt: true, altGraph: true }), withJunk, { hasWorkspace: true })).toBeNull()
            expect(matchKeybind(keyEvent('CapsLock'), withJunk, { hasWorkspace: true })).toBeNull()
        })

        it('ignores key presses that are part of IME input', () => {
            expect(matchKeybind(keyEvent('s', { ctrl: true, isComposing: true }), bindings)).toBeNull()
            expect(matchKeybind(keyEvent('s', { ctrl: true, keyCode: 229 }), bindings)).toBeNull()

            const withProcess = { ...bindings, 'view.toggleExplorer': [{ key: 'Process', ctrl: true }] }
            expect(matchKeybind(keyEvent('Process', { ctrl: true, code: 'KeyA' }), withProcess, { hasWorkspace: true })).toBeNull()
        })

        it('never matches a dead key as itself, only by its physical key', () => {
            const withDead = { ...bindings, 'view.toggleExplorer': [{ key: 'Dead', ctrl: true }] }
            expect(matchKeybind(keyEvent('Dead', { ctrl: true, code: 'Quote' }), withDead, { hasWorkspace: true })).toBeNull()

            // Shift+6 is a dead ^ on US International; Ctrl+Shift+6 still matches by the digit.
            const withDigit = { ...bindings, 'view.fitDiagram': [{ key: '6', ctrl: true, shift: true }] }
            expect(matchKeybind(keyEvent('Dead', { ctrl: true, shift: true, code: 'Digit6' }), withDigit, { hasWorkspace: true })).toBe(
                'view.fitDiagram'
            )
        })
    })

    describe('inside the code editor', () => {
        // Monaco's hidden textarea (macOS, Linux) and its find box, and its input div on Windows.
        const editorTarget = (tagName: string) =>
            ({ tagName, closest: (selector: string) => (selector === '.monaco-editor' ? {} : null) }) as unknown as EventTarget

        it('lets real shortcuts through on every platform', () => {
            expect(matchKeybind(keyEvent('s', { ctrl: true }, editorTarget('TEXTAREA')), bindings)).toBe('document.save')
            expect(matchKeybind(keyEvent('s', { meta: true }, editorTarget('TEXTAREA')), createDefaultKeybinds(true))).toBe('document.save')
            expect(matchKeybind(keyEvent('b', { ctrl: true }, editorTarget('DIV')), bindings, { hasWorkspace: true })).toBe('view.toggleExplorer')
            expect(matchKeybind(keyEvent('F1', {}, editorTarget('TEXTAREA')), bindings)).toBe('palette.open')
        })

        it('never fires a bare key there', () => {
            const bareKey = { ...bindings, 'view.toggleExplorer': [{ key: 'e' }] }
            expect(matchKeybind(keyEvent('e', {}, editorTarget('DIV')), bareKey, { hasWorkspace: true })).toBeNull()
            expect(matchKeybind(keyEvent('e', {}, editorTarget('TEXTAREA')), bareKey, { hasWorkspace: true })).toBeNull()
        })

        it('still skips shortcuts in plain inputs outside the editor', () => {
            const input = { tagName: 'INPUT', closest: () => null } as unknown as EventTarget
            expect(matchKeybind(keyEvent('b', { ctrl: true }, input), bindings, { hasWorkspace: true })).toBeNull()
        })
    })

    describe('in the command palette search box', () => {
        const input = { tagName: 'INPUT', closest: () => null } as unknown as EventTarget

        it('lets the shortcuts that switch the palette through', () => {
            expect(matchKeybind(keyEvent('f', { ctrl: true, shift: true }, input), bindings, { inPalette: true })).toBe('palette.openText')
            expect(matchKeybind(keyEvent('n', { ctrl: true, shift: true }, input), bindings, { inPalette: true })).toBe('palette.openFiles')
        })

        it('still skips the other shortcuts, and every shortcut when not in the palette', () => {
            expect(matchKeybind(keyEvent('s', { ctrl: true }, input), bindings, { inPalette: true })).toBeNull()
            expect(matchKeybind(keyEvent('f', { ctrl: true, shift: true }, input), bindings)).toBeNull()
        })

        it('never fires a bare key there', () => {
            const bareKey = { ...bindings, 'palette.openFiles': [{ key: 'n' }] }
            expect(matchKeybind(keyEvent('n', {}, input), bareKey, { inPalette: true })).toBeNull()
        })
    })

    describe('moving between panes', () => {
        const workspace = { hasWorkspace: true }
        const input = { tagName: 'INPUT', closest: () => null } as unknown as EventTarget
        const editor = { tagName: 'TEXTAREA', closest: (selector: string) => (selector === '.monaco-editor' ? {} : null) } as unknown as EventTarget

        it('focuses the explorer, editor and preview, and F6 / Shift+F6 cycle the panes, once a folder is open', () => {
            expect(matchKeybind(keyEvent('E', { ctrl: true, shift: true }), bindings, workspace)).toBe('view.focusExplorer')
            expect(matchKeybind(keyEvent('1', { ctrl: true }), bindings, workspace)).toBe('view.focusEditor')
            expect(matchKeybind(keyEvent('2', { ctrl: true }), bindings, workspace)).toBe('view.focusPreview')
            expect(matchKeybind(keyEvent('F6'), bindings, workspace)).toBe('view.focusNextPane')
            expect(matchKeybind(keyEvent('F6', { shift: true }), bindings, workspace)).toBe('view.focusPreviousPane')
            expect(matchKeybind(keyEvent('F6'), bindings)).toBeNull()
        })

        it('uses Cmd on macOS', () => {
            expect(matchKeybind(keyEvent('1', { meta: true }), createDefaultKeybinds(true), workspace)).toBe('view.focusEditor')
        })

        it('lets F6 and Shift+F6 out of the editor and out of a text box', () => {
            expect(matchKeybind(keyEvent('F6', {}, editor), bindings, workspace)).toBe('view.focusNextPane')
            expect(matchKeybind(keyEvent('F6', { shift: true }, input), bindings, workspace)).toBe('view.focusPreviousPane')
        })

        it('leaves the other focus keys to a text box, but not to the editor', () => {
            expect(matchKeybind(keyEvent('2', { ctrl: true }, input), bindings, workspace)).toBeNull()
            expect(matchKeybind(keyEvent('2', { ctrl: true }, editor), bindings, workspace)).toBe('view.focusPreview')
        })
    })

    it('does not treat non-field targets as native text fields', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true }, {} as EventTarget), bindings)).toBe('document.save')
    })
})
