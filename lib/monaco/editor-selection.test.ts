import { describe, expect, it } from 'vitest'
import { readEditorSelectedText } from './editor-selection'

describe('readEditorSelectedText', () => {
    it('returns null when editor is missing', () => {
        expect(readEditorSelectedText(null)).toBeNull()
    })

    it('returns null when selection is empty', () => {
        const editor = {
            getModel: () => ({ getValueInRange: () => 'hello' }),
            getSelection: () => ({ isEmpty: () => true }),
        }

        expect(readEditorSelectedText(editor as never)).toBeNull()
    })

    it('returns null when selection is whitespace only', () => {
        const editor = {
            getModel: () => ({
                getValueInRange: () => '   ',
            }),
            getSelection: () => ({ isEmpty: () => false }),
        }

        expect(readEditorSelectedText(editor as never)).toBeNull()
    })

    it('returns selected text including internal whitespace', () => {
        const editor = {
            getModel: () => ({
                getValueInRange: () => '  hello world  ',
            }),
            getSelection: () => ({ isEmpty: () => false }),
        }

        expect(readEditorSelectedText(editor as never)).toBe('  hello world  ')
    })
})
