import { describe, expect, it } from 'vitest'
import { defaultMarkdownFor, titleFromFileName } from './default-markdown'

describe('titleFromFileName', () => {
    it('turns a file name into a heading', () => {
        expect(titleFromFileName('meeting-notes.md')).toBe('Meeting notes')
        expect(titleFromFileName('release_plan  v2.MD')).toBe('Release plan v2')
        expect(titleFromFileName('README.md')).toBe('README')
        expect(titleFromFileName('notes.v2.md')).toBe('Notes.v2')
    })

    it('gives nothing for a name that is only an extension', () => {
        expect(titleFromFileName('.md')).toBe('')
    })
})

describe('defaultMarkdownFor', () => {
    it('starts a new document with a heading named after the file, and no sample content', () => {
        expect(defaultMarkdownFor('meeting-notes.md')).toBe('# Meeting notes\n\n')
    })

    it('leaves a file with no usable name empty', () => {
        expect(defaultMarkdownFor('.md')).toBe('')
    })
})
