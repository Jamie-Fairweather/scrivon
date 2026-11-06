import { describe, expect, it } from 'vitest'
import { markdownUrlTransform, resolveMarkdownLink, type MarkdownLinkContext } from './markdown-links'

const inWorkspace: MarkdownLinkContext = { documentPath: 'C:\\notes/docs/guide.md', workspaceRoot: 'C:\\notes' }

describe('resolveMarkdownLink', () => {
    it('treats #fragments as in-document anchors', () => {
        expect(resolveMarkdownLink('#install', inWorkspace)).toEqual({ kind: 'anchor', id: 'install' })
        expect(resolveMarkdownLink('#user-content-fn-1', inWorkspace)).toEqual({ kind: 'anchor', id: 'user-content-fn-1' })
        expect(resolveMarkdownLink('#caf%C3%A9', inWorkspace)).toEqual({ kind: 'anchor', id: 'café' })
        expect(resolveMarkdownLink('#', inWorkspace)).toEqual({ kind: 'none' })
    })

    it('sends web, email and phone links to the system', () => {
        expect(resolveMarkdownLink('https://example.com/a?b=1#c', inWorkspace)).toEqual({ kind: 'external', url: 'https://example.com/a?b=1#c' })
        expect(resolveMarkdownLink('HTTP://example.com', inWorkspace)).toEqual({ kind: 'external', url: 'HTTP://example.com' })
        expect(resolveMarkdownLink('mailto:me@example.com', inWorkspace)).toEqual({ kind: 'external', url: 'mailto:me@example.com' })
        expect(resolveMarkdownLink('tel:+441234', inWorkspace)).toEqual({ kind: 'external', url: 'tel:+441234' })
    })

    it('resolves relative file links against the document folder, keeping its path style', () => {
        expect(resolveMarkdownLink('setup.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/setup.md', fragment: null })
        expect(resolveMarkdownLink('./api/ref.md#auth', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/api/ref.md', fragment: 'auth' })
        expect(resolveMarkdownLink('../README.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/README.md', fragment: null })
        expect(resolveMarkdownLink('my%20notes.md?raw=1', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/my notes.md', fragment: null })
        expect(resolveMarkdownLink('img\\chart.png', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/img/chart.png', fragment: null })
    })

    it('uses backslashes when the document path does', () => {
        const context = { documentPath: 'D:\\docs\\a.md', workspaceRoot: null }
        expect(resolveMarkdownLink('sub/b.md', context)).toEqual({ kind: 'file', path: 'D:\\docs\\sub\\b.md', fragment: null })
        expect(resolveMarkdownLink('../../../x.md', context)).toEqual({ kind: 'file', path: 'D:\\x.md', fragment: null })
    })

    it('resolves POSIX paths', () => {
        const context = { documentPath: '/home/me/notes/a.md', workspaceRoot: '/home/me/notes' }
        expect(resolveMarkdownLink('b.md', context)).toEqual({ kind: 'file', path: '/home/me/notes/b.md', fragment: null })
        expect(resolveMarkdownLink('../../c.md', context)).toEqual({ kind: 'file', path: '/home/c.md', fragment: null })
    })

    it('resolves links starting with / from the open folder, like a repository root', () => {
        expect(resolveMarkdownLink('/docs/other.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/other.md', fragment: null })
        expect(resolveMarkdownLink('/x.md', { documentPath: '/a/b.md', workspaceRoot: null })).toEqual({
            kind: 'file',
            path: '/x.md',
            fragment: null,
        })
    })

    it('keeps absolute Windows and UNC paths', () => {
        expect(resolveMarkdownLink('C:\\specs\\a.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\specs\\a.md', fragment: null })
        expect(resolveMarkdownLink('C:%5Cspecs%5Ca.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\specs\\a.md', fragment: null })
        expect(resolveMarkdownLink('C:/specs/a.md#top', inWorkspace)).toEqual({ kind: 'file', path: 'C:/specs/a.md', fragment: 'top' })
        expect(resolveMarkdownLink('\\\\server\\share\\a.md', inWorkspace)).toEqual({ kind: 'file', path: '\\\\server\\share\\a.md', fragment: null })
    })

    it('handles links to the same file and bare ?queries', () => {
        expect(resolveMarkdownLink('guide.md#intro', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/guide.md', fragment: 'intro' })
        expect(resolveMarkdownLink('?x=1#intro', inWorkspace)).toEqual({ kind: 'anchor', id: 'intro' })
        expect(resolveMarkdownLink('?x=1', inWorkspace)).toEqual({ kind: 'none' })
    })

    it('cannot resolve relative links without a document folder', () => {
        expect(resolveMarkdownLink('other.md', { documentPath: null, workspaceRoot: null })).toEqual({ kind: 'unresolved' })
        expect(resolveMarkdownLink('other.md', { documentPath: 'untitled.md', workspaceRoot: null })).toEqual({ kind: 'unresolved' })
    })

    it('rejects other URL schemes and empty links', () => {
        expect(resolveMarkdownLink('irc://irc.example.com/room', inWorkspace)).toEqual({ kind: 'unsupported' })
        expect(resolveMarkdownLink('', inWorkspace)).toEqual({ kind: 'none' })
        expect(resolveMarkdownLink(undefined, inWorkspace)).toEqual({ kind: 'none' })
    })

    it('leaves malformed percent escapes as written', () => {
        expect(resolveMarkdownLink('100%.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\notes/docs/100%.md', fragment: null })
    })
})

describe('markdownUrlTransform', () => {
    it('keeps Windows paths that the default transform would blank', () => {
        expect(markdownUrlTransform('C:\\docs\\a.md')).toBe('C:\\docs\\a.md')
        expect(markdownUrlTransform('d:/docs/a.md')).toBe('d:/docs/a.md')
        expect(markdownUrlTransform('C:%5Cdocs%5Ca.md')).toBe('C:%5Cdocs%5Ca.md')
    })

    it('still blanks unsafe schemes', () => {
        expect(markdownUrlTransform('javascript:alert(1)')).toBe('')
        expect(markdownUrlTransform('notes/a.md')).toBe('notes/a.md')
        expect(markdownUrlTransform('https://example.com')).toBe('https://example.com')
    })
})
