import { describe, expect, it } from 'vitest'
import { savePathBesideDocument } from '@/lib/tauri/save-path'

describe('savePathBesideDocument', () => {
    it.each([
        ['D:\\Projects\\spec\\flow.mmd', 'flow.svg', 'D:\\Projects\\spec\\flow.svg'],
        ['D:\\Projects\\spec\\spec.md', 'spec.pdf', 'D:\\Projects\\spec\\spec.pdf'],
        ['C:\\flow.mmd', 'flow.svg', 'C:\\flow.svg'],
        ['c:/docs/a.md', 'a.pdf', 'c:/docs/a.pdf'],
        ['\\\\server\\share\\notes.md', 'notes.docx', '\\\\server\\share\\notes.docx'],
        ['/home/ada/notes.md', 'notes.pdf', '/home/ada/notes.pdf'],
        // An example tab or a missing path has no folder, so the dialog picks one.
        ['example:markdown-intro', 'intro.pdf', 'intro.pdf'],
        [undefined, 'flow.svg', 'flow.svg'],
    ])('%s + %s -> %s', (documentPath, fileName, expected) => {
        expect(savePathBesideDocument(fileName, documentPath)).toBe(expected)
    })
})
