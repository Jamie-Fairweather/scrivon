import { describe, expect, it } from 'vitest'
import { markdownPreviewBody } from './markdown-preview-body'

describe('markdownPreviewBody', () => {
    it('leaves the front matter out', () => {
        expect(markdownPreviewBody('---\ntitle: Notes\n---\n# Body')).toBe('# Body')
    })
})
