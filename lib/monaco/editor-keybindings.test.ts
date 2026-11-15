import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { describe, expect, it, vi } from 'vitest'
import { leaveF1ToAppKeybinds } from './editor-keybindings'

const F1 = 59

describe('leaveF1ToAppKeybinds', () => {
    it("binds F1 to nothing in the editor, so Monaco's own command list doesn't open on it", () => {
        const addCommand = vi.fn()
        leaveF1ToAppKeybinds({ addCommand } as unknown as editor.IStandaloneCodeEditor, { KeyCode: { F1 } } as unknown as Monaco)
        expect(addCommand).toHaveBeenCalledWith(F1, expect.any(Function))
        expect(() => addCommand.mock.calls[0]![1]()).not.toThrow()
    })
})
