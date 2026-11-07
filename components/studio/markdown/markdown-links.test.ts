import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import {
    anchorKey,
    isPathInside,
    isSamePath,
    markdownUrlTransform,
    resolveMarkdownLink,
    workspaceFilePath,
    type MarkdownLinkContext,
} from './markdown-links'

describe('anchorKey', () => {
    it('reduces GitHub’s heading ids and export’s to the same key', () => {
        // [GitHub's id, export's id] for one heading.
        for (const [github, exported] of [
            ['foo--bar', 'foo-bar'], // ## Foo & Bar
            ['install---windows', 'install-windows'], // ## Install - Windows
            ['-quick-start', 'quick-start'], // ## 🚀 Quick start
            ['über', 'ber'], // ## Über
            ['api-v2', 'api-v2'],
            ['Setup', 'setup'],
        ]) {
            expect(anchorKey(github!)).toBe(anchorKey(exported!))
        }
        expect(anchorKey('🚀')).toBe('')
    })
})

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
        expect(resolveMarkdownLink('/../../x.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:/x.md', fragment: null })
        // Without an open folder there is no root to start from, and the root of the disk isn't it.
        expect(resolveMarkdownLink('/x.md', { documentPath: '/a/b.md', workspaceRoot: null })).toEqual({ kind: 'unresolved' })
    })

    it('keeps absolute Windows paths, resolving . and ..', () => {
        expect(resolveMarkdownLink('C:\\specs\\a.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\specs\\a.md', fragment: null })
        expect(resolveMarkdownLink('C:%5Cspecs%5Ca.md', inWorkspace)).toEqual({ kind: 'file', path: 'C:\\specs\\a.md', fragment: null })
        expect(resolveMarkdownLink('C:/specs/a.md#top', inWorkspace)).toEqual({ kind: 'file', path: 'C:/specs/a.md', fragment: 'top' })
        expect(resolveMarkdownLink('C:\\notes\\..\\..\\specs\\.\\a.md', inWorkspace)).toEqual({
            kind: 'file',
            path: 'C:\\specs\\a.md',
            fragment: null,
        })
    })

    describe('network shares', () => {
        it('never follows a link to another computer', () => {
            for (const href of [
                '\\\\server\\share\\a.md',
                // How the Markdown parser hands over `\\evil\share\setup.exe`.
                '%5C%5Cevil%5Cshare%5Csetup.exe',
                '//evil/share/x.md',
                '\\/evil/share/x.md',
                '/\\evil\\share\\x.md',
                '\\\\evil',
                '\\\\?\\C:\\notes\\a.md',
                '\\\\.\\pipe\\x',
                '\\\\?\\UNC\\evil\\share\\x.md',
            ]) {
                expect({ href, target: resolveMarkdownLink(href, inWorkspace) }).toEqual({ href, target: { kind: 'network' } })
                expect({ href, target: resolveMarkdownLink(href, { documentPath: null, workspaceRoot: null }) }).toEqual({
                    href,
                    target: { kind: 'network' },
                })
            }
        })

        it('follows links within the share the open folder is on', () => {
            const onShare = { documentPath: '\\\\nas\\team\\notes\\a.md', workspaceRoot: '\\\\nas\\team\\notes' }
            expect(resolveMarkdownLink('b.md', onShare)).toEqual({ kind: 'file', path: '\\\\nas\\team\\notes\\b.md', fragment: null })
            expect(resolveMarkdownLink('\\\\NAS\\Team\\other\\c.md', onShare)).toEqual({
                kind: 'file',
                path: '\\\\NAS\\Team\\other\\c.md',
                fragment: null,
            })
            expect(resolveMarkdownLink('/d.md', onShare)).toEqual({ kind: 'file', path: '\\\\nas\\team\\notes/d.md', fragment: null })
            expect(resolveMarkdownLink('\\\\nas\\other\\x.md', onShare)).toEqual({ kind: 'network' })
            expect(resolveMarkdownLink('\\\\evil\\share\\x.md', onShare)).toEqual({ kind: 'network' })
        })

        it("can't climb out of the open share with ..", () => {
            const onShare = { documentPath: '\\\\nas\\team\\notes\\a.md', workspaceRoot: '\\\\nas\\team\\notes' }
            expect(resolveMarkdownLink('../../../evil/share/x.md', onShare)).toEqual({
                kind: 'file',
                path: '\\\\nas\\team\\evil\\share\\x.md',
                fragment: null,
            })
            expect(resolveMarkdownLink('\\\\nas\\team\\..\\..\\evil\\share\\x.md', onShare)).toEqual({
                kind: 'file',
                path: '\\\\nas\\team\\evil\\share\\x.md',
                fragment: null,
            })
        })
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

describe('paths', () => {
    it('treats Windows paths as the same whatever their separators and letter case', () => {
        expect(isSamePath('C:\\notes/docs/a.md', 'c:\\NOTES\\docs\\A.md')).toBe(true)
        expect(isSamePath('\\\\nas\\team\\a.md', '//NAS/team/a.md')).toBe(true)
        expect(isSamePath('/home/me/a.md', '/home/me/A.md')).toBe(false)
        expect(isSamePath('C:\\notes\\a.md', 'C:\\notes\\b.md')).toBe(false)
    })

    it('knows whether a path is inside the open folder', () => {
        expect(isPathInside('C:\\NOTES\\docs\\a.md', 'C:\\notes')).toBe(true)
        expect(isPathInside('C:\\notes/a.md', 'C:\\notes\\')).toBe(true)
        expect(isPathInside('C:\\notes-old\\a.md', 'C:\\notes')).toBe(false)
        expect(isPathInside('C:\\notes', 'C:\\notes')).toBe(false)
        expect(isPathInside('D:\\a.md', 'C:\\')).toBe(false)
        expect(isPathInside('C:\\a.md', 'C:\\')).toBe(true)
        expect(isPathInside('/home/me/notes/a.md', '/home/me/notes')).toBe(true)
        expect(isPathInside('/home/me/Notes/a.md', '/home/me/notes')).toBe(false)
    })

    it('uses the explorer’s path for a linked file, or the explorer’s form of it', () => {
        const tree: FileNode[] = [
            {
                kind: 'directory',
                name: 'docs',
                path: 'C:\\notes/docs',
                children: [{ kind: 'file', name: 'Setup.md', path: 'C:\\notes/docs/Setup.md' }],
            },
        ]
        expect(workspaceFilePath('c:\\notes\\DOCS\\setup.md', 'C:\\notes', tree)).toBe('C:\\notes/docs/Setup.md')
        expect(workspaceFilePath('C:\\notes\\docs\\new\\b.md', 'C:\\notes', tree)).toBe('C:\\notes/docs/new/b.md')
        expect(workspaceFilePath('C:\\b.md', 'C:\\', [])).toBe('C:/b.md')
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
