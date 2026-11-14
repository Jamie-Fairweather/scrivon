import { describe, expect, it } from 'vitest'
import { markdownPreviewBody, markdownPreviewDocument } from './markdown-preview-body'

describe('markdownPreviewDocument', () => {
    it('leaves the front matter out of the body and keeps its lang', () => {
        expect(markdownPreviewDocument('---\nlang: ja\ntitle: Notes\n---\n# 本文')).toEqual({ body: '# 本文', lang: 'ja' })
    })

    it('has no lang when the front matter has none', () => {
        expect(markdownPreviewDocument('---\ntitle: Notes\n---\n# Body').lang).toBeUndefined()
        expect(markdownPreviewDocument('# Body')).toEqual({ body: '# Body' })
    })
})

describe('markdownPreviewBody', () => {
    it('is the body the preview shows', () => {
        const source = '---\nlang: ja\n---\n# Body'
        expect(markdownPreviewBody(source)).toBe(markdownPreviewDocument(source).body)
        expect(markdownPreviewBody('---\ntitle: Notes\n---\n# Body')).toBe('# Body')
    })
})
