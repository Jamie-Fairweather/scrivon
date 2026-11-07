import { describe, expect, it } from 'vitest'
import { editorAriaLabel } from './editor-aria'

describe('editorAriaLabel', () => {
    it('names the file and explains how to leave the editor with the keyboard', () => {
        expect(editorAriaLabel({ name: 'notes.md' }, false)).toBe(
            'notes.md, Markdown editor. Press Control+M to make the Tab key move focus instead of indenting.'
        )
    })

    it('says when a diagram is read-only, and uses the macOS shortcut on a Mac', () => {
        expect(editorAriaLabel({ name: 'Flowchart.mmd', readOnly: true }, true)).toBe(
            'Flowchart.mmd, Mermaid editor, read-only. Press Control+Shift+M to make the Tab key move focus instead of indenting.'
        )
    })

    it('falls back to a plain name with no file open', () => {
        expect(editorAriaLabel(null, false)).toBe('Editor')
    })
})
