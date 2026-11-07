import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { decodeKeybinding } from 'monaco-editor/esm/vs/base/common/keybindings.js'
import { CommandsRegistry } from 'monaco-editor/esm/vs/platform/commands/common/commands.js'
import { ContextKeyExpr } from 'monaco-editor/esm/vs/platform/contextkey/common/contextkey.js'
import { KeybindingResolver } from 'monaco-editor/esm/vs/platform/keybinding/common/keybindingResolver.js'
import { ResolvedKeybindingItem } from 'monaco-editor/esm/vs/platform/keybinding/common/resolvedKeybindingItem.js'
import { USLayoutResolvedKeybinding } from 'monaco-editor/esm/vs/platform/keybinding/common/usLayoutResolvedKeybinding.js'
import { describe, expect, it, vi } from 'vitest'
import { bindEditorCommandPaletteToApp, MONACO_QUICK_COMMAND_ID } from './editor-keybindings'

const F1 = 59
const WINDOWS = 1

/**
 * An editor and a Monaco whose registerCommand is Monaco's real one, so "newest wins" is Monaco's own
 * rule. Keybinding rules the code adds are kept in `rules` while they are in force.
 */
function fakeEditorAndMonaco() {
    const addCommand = vi.fn()
    const editorInstance = { addCommand } as unknown as editor.IStandaloneCodeEditor
    const rules = new Set<editor.IKeybindingRule>()
    const monaco = {
        KeyCode: { F1 },
        editor: {
            registerCommand: (id: string, handler: (accessor: unknown) => void) => CommandsRegistry.registerCommand(id, handler),
            addKeybindingRule: (rule: editor.IKeybindingRule) => {
                rules.add(rule)
                return { dispose: () => rules.delete(rule) }
            },
        },
    } as unknown as Monaco
    return { editorInstance, monaco, addCommand, rules }
}

/** What the editor's right-click 'Command Palette' does: run the command by id from the shared registry. */
function runMenuEntry() {
    return CommandsRegistry.getCommand(MONACO_QUICK_COMMAND_ID)?.handler(undefined)
}

/**
 * The key the right-click menu shows next to 'Command Palette'. Built the way Monaco's standalone
 * keybinding service builds its table: Monaco's own rule (F1 while the editor has focus), then the
 * rules added since, with Monaco's real resolver deciding what is left.
 */
function menuKeyForCommandPalette(added: Iterable<editor.IKeybindingRule>) {
    const toItems = (rules: { keybinding: number; command: string; when?: ReturnType<typeof ContextKeyExpr.has> }[], isDefault: boolean) =>
        rules.flatMap(({ keybinding, command, when }) =>
            USLayoutResolvedKeybinding.resolveKeybinding(decodeKeybinding(keybinding, WINDOWS)!, WINDOWS).map(
                (resolved) => new ResolvedKeybindingItem(resolved, command, undefined, when, isDefault, null, false)
            )
        )
    const monacoOwn = toItems([{ keybinding: F1, command: MONACO_QUICK_COMMAND_ID, when: ContextKeyExpr.has('editorFocus') }], true)
    const addedItems = toItems(
        [...added].map((rule) => ({ keybinding: rule.keybinding, command: rule.command ?? '' })),
        false
    )
    return new KeybindingResolver(monacoOwn, addedItems, () => {}).lookupPrimaryKeybinding(MONACO_QUICK_COMMAND_ID, undefined)
}

describe('bindEditorCommandPaletteToApp', () => {
    it("makes the right-click 'Command Palette' open the app palette instead of Monaco's list, until it is disposed", () => {
        // Monaco registers its own command list under this id when it loads.
        const openMonacoList = vi.fn()
        const monacoOwn = CommandsRegistry.registerCommand(MONACO_QUICK_COMMAND_ID, openMonacoList)
        const openPalette = vi.fn()
        const { editorInstance, monaco } = fakeEditorAndMonaco()

        const binding = bindEditorCommandPaletteToApp(editorInstance, monaco, openPalette)
        runMenuEntry()
        expect(openPalette).toHaveBeenCalledTimes(1)
        expect(openMonacoList).not.toHaveBeenCalled()

        // Once the editor is gone, nothing points at its palette any more.
        binding.dispose()
        runMenuEntry()
        expect(openPalette).toHaveBeenCalledTimes(1)
        monacoOwn.dispose()
    })

    it("leaves F1 to the app's keybinds, so a palette moved to another key doesn't also open on F1 in the editor", () => {
        const openPalette = vi.fn()
        const { editorInstance, monaco, addCommand } = fakeEditorAndMonaco()

        const binding = bindEditorCommandPaletteToApp(editorInstance, monaco, openPalette)
        expect(addCommand).toHaveBeenCalledWith(F1, expect.any(Function))
        addCommand.mock.calls[0]![1]()
        expect(openPalette).not.toHaveBeenCalled()
        binding.dispose()
    })

    it("stops the right-click menu showing F1 next to 'Command Palette', since F1 no longer opens it there", () => {
        const { editorInstance, monaco, rules } = fakeEditorAndMonaco()
        expect(menuKeyForCommandPalette(rules)?.command).toBe(MONACO_QUICK_COMMAND_ID)

        const binding = bindEditorCommandPaletteToApp(editorInstance, monaco, vi.fn())
        expect(menuKeyForCommandPalette(rules)).toBeNull()

        // Once the editor is gone, Monaco's own rule is back along with its own command list.
        binding.dispose()
        expect(menuKeyForCommandPalette(rules)?.command).toBe(MONACO_QUICK_COMMAND_ID)
    })
})
