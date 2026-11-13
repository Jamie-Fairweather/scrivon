import { describe, expect, it } from 'vitest'
import {
    documentExtension,
    documentKind,
    fileExtension,
    isMarkdownFile,
    isMermaidFile,
    isSupportedDocument,
    supportedExtensionsLabel,
    withDocumentExtension,
} from './file-types'

describe('supportedExtensionsLabel', () => {
    it('lists every extension Scrivon opens, .markdown and .mermaid included', () => {
        expect(supportedExtensionsLabel('and')).toBe('.md, .markdown, .mmd and .mermaid')
        expect(supportedExtensionsLabel('or')).toBe('.md, .markdown, .mmd or .mermaid')
        for (const ext of ['.md', '.markdown', '.mmd', '.mermaid']) expect(isSupportedDocument(`file${ext}`)).toBe(true)
    })
})

describe('isMarkdownFile', () => {
    it('matches .md and .markdown case-insensitively', () => {
        expect(isMarkdownFile('notes.md')).toBe(true)
        expect(isMarkdownFile('NOTES.MD')).toBe(true)
        expect(isMarkdownFile('notes.markdown')).toBe(true)
        expect(isMarkdownFile('Notes.Markdown')).toBe(true)
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
        expect(documentKind('readme.markdown')).toBe('markdown')
        expect(documentKind('flow.mmd')).toBe('mermaid')
        expect(documentKind('flow.mermaid')).toBe('mermaid')
        expect(documentKind('image.png')).toBeNull()
    })
})

describe('documentExtension', () => {
    it('returns the supported extension as written, or null', () => {
        expect(documentExtension('notes.md')).toBe('.md')
        expect(documentExtension('notes.Markdown')).toBe('.Markdown')
        expect(documentExtension('Flow.MMD')).toBe('.MMD')
        expect(documentExtension('flow.mermaid')).toBe('.mermaid')
        expect(documentExtension('image.png')).toBeNull()
        expect(documentExtension('drafts')).toBeNull()
    })
})

describe('fileExtension', () => {
    it('returns the extension of any file as written, or null when it has none', () => {
        expect(fileExtension('a.png')).toBe('.png')
        expect(fileExtension('Photo.JPG')).toBe('.JPG')
        expect(fileExtension('backup.tar.gz')).toBe('.gz')
        expect(fileExtension('notes.md')).toBe('.md')
        expect(fileExtension('.gitignore')).toBeNull()
        expect(fileExtension('drafts')).toBeNull()
        expect(fileExtension('a.')).toBeNull()
        expect(fileExtension('Dr. Smith')).toBeNull()
    })
})

describe('withDocumentExtension', () => {
    it('adds the extension only when the name has no supported one', () => {
        expect(withDocumentExtension('login flow', '.mmd')).toBe('login flow.mmd')
        expect(withDocumentExtension('v1.2 plan', '.md')).toBe('v1.2 plan.md')
        expect(withDocumentExtension('notes.md', '.mmd')).toBe('notes.md')
        expect(withDocumentExtension('flow.MERMAID', '.mmd')).toBe('flow.MERMAID')
        expect(withDocumentExtension('', '.mmd')).toBe('')
        expect(withDocumentExtension('Notes 2026.11.07', '.md')).toBe('Notes 2026.11.07.md')
        expect(withDocumentExtension('Dr. Smith', '.md')).toBe('Dr. Smith.md')
    })

    it('leaves a name with another extension as typed, so it is refused instead of becoming todo.txt.md', () => {
        expect(withDocumentExtension('todo.txt', '.md')).toBe('todo.txt')
        expect(withDocumentExtension('notes.TXT', '.mmd')).toBe('notes.TXT')
        expect(isSupportedDocument(withDocumentExtension('todo.txt', '.md'))).toBe(false)
    })
})
