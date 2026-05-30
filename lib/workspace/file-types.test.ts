import { describe, expect, it } from 'vitest'
import { documentKind, isMarkdownFile, isMermaidFile, isSupportedDocument } from './file-types'

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
