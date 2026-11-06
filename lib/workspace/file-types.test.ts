import { describe, expect, it } from 'vitest'
import { documentExtension, documentKind, isMarkdownFile, isMermaidFile, isSupportedDocument, withDocumentExtension } from './file-types'

describe('isMarkdownFile', () => {
    it('matches .md case-insensitively', () => {
        expect(isMarkdownFile('notes.md')).toBe(true)
        expect(isMarkdownFile('NOTES.MD')).toBe(true)
        expect(isMarkdownFile('notes.mmd')).toBe(false)
    })
})

describe('isMermaidFile', () => {
    it('matches .mmd and .mermaid case-insensitively', () => {
        expect(isMermaidFile('flow.mmd')).toBe(true)
        expect(isMermaidFile('flow.MMD')).toBe(true)
        expect(isMermaidFile('flow.mermaid')).toBe(true)
        expect(isMermaidFile('flow.md')).toBe(false)
    })
})

describe('isSupportedDocument', () => {
    it('accepts markdown and mermaid files only', () => {
        expect(isSupportedDocument('readme.md')).toBe(true)
        expect(isSupportedDocument('diagram.mmd')).toBe(true)
        expect(isSupportedDocument('image.png')).toBe(false)
    })
})

describe('documentKind', () => {
    it('returns the document kind or null', () => {
        expect(documentKind('readme.md')).toBe('markdown')
        expect(documentKind('flow.mmd')).toBe('mermaid')
        expect(documentKind('flow.mermaid')).toBe('mermaid')
        expect(documentKind('image.png')).toBeNull()
    })
})

describe('documentExtension', () => {
    it('returns the supported extension as written, or null', () => {
        expect(documentExtension('notes.md')).toBe('.md')
        expect(documentExtension('Flow.MMD')).toBe('.MMD')
        expect(documentExtension('flow.mermaid')).toBe('.mermaid')
        expect(documentExtension('image.png')).toBeNull()
        expect(documentExtension('drafts')).toBeNull()
    })
})

describe('withDocumentExtension', () => {
    it('adds the extension only when the name has no supported one', () => {
        expect(withDocumentExtension('login flow', '.mmd')).toBe('login flow.mmd')
        expect(withDocumentExtension('v1.2 plan', '.md')).toBe('v1.2 plan.md')
        expect(withDocumentExtension('notes.md', '.mmd')).toBe('notes.md')
        expect(withDocumentExtension('flow.MERMAID', '.mmd')).toBe('flow.MERMAID')
        expect(withDocumentExtension('', '.mmd')).toBe('')
    })
})
