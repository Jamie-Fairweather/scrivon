import { beforeEach, describe, expect, it, vi } from 'vitest'
import { documentLinks } from '@/lib/markdown/document-links'
import { findBrokenLinks, MAX_LINK_MARKS, type LinkCheckContext } from '@/lib/workspace/broken-links'
import { buildLinkIndex, lookupLinkTarget } from '@/lib/workspace/link-index'
import { checkLinkTarget, forgetLinkTargets, subscribeLinkTargets } from '@/lib/workspace/link-target-cache'
import { MAX_PARALLEL_READS } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'
import { buildWikiIndex } from '@/lib/workspace/wiki-link-lookup'

const ROOT = 'C:\\notes'
const DOC = 'C:\\notes\\guide.md'

const file = (path: string): FileNode => ({ kind: 'file', name: path.slice(path.lastIndexOf('\\') + 1), path })
const folder = (path: string, children: FileNode[], flags: Partial<Extract<FileNode, { kind: 'directory' }>> = {}): FileNode => ({
    kind: 'directory',
    name: path.slice(path.lastIndexOf('\\') + 1),
    path,
    children,
    ...flags,
})

const TREE: FileNode[] = [
    folder('C:\\notes\\docs', [file('C:\\notes\\docs\\Setup.md'), file('C:\\notes\\docs\\other.md'), folder('C:\\notes\\docs\\sub', [])]),
    folder('C:\\notes\\assets', [file('C:\\notes\\assets\\chart.png')]),
    folder('C:\\notes\\big', [], { truncated: true }),
    folder('C:\\notes\\locked', [], { unreadable: true }),
    file('C:\\notes\\my file.md'),
    file('C:\\notes\\a(1).md'),
    file('C:\\notes\\a)b.md'),
    file('C:\\notes\\package.json'),
    file(DOC),
]

function context(overrides: Partial<LinkCheckContext> = {}): LinkCheckContext {
    return {
        documentPath: DOC,
        workspaceRoot: ROOT,
        index: buildLinkIndex(ROOT, TREE),
        openText: () => undefined,
        anchorsOf: async (text) => documentLinks(text).anchors,
        checkOnDisk: vi.fn(async () => 'missing' as const),
        ...overrides,
    }
}

async function broken(source: string, overrides: Partial<LinkCheckContext> = {}) {
    const found = await findBrokenLinks(source, documentLinks(source), context(overrides))
    return found.map((link) => ({ text: source.slice(link.span.start, link.span.end), message: link.message }))
}

beforeEach(() => forgetLinkTargets())

describe('lookupLinkTarget', () => {
    const index = buildLinkIndex(ROOT, TREE)

    it('finds files and folders whatever the letter case and separators', () => {
        expect(lookupLinkTarget(index, 'C:/notes/DOCS/setup.MD')).toMatchObject({
            kind: 'found',
            entry: { kind: 'file', path: 'C:\\notes\\docs\\Setup.md' },
        })
        expect(lookupLinkTarget(index, 'C:\\notes\\docs\\sub')).toMatchObject({ kind: 'found', entry: { kind: 'directory' } })
        expect(lookupLinkTarget(index, 'C:\\notes')).toMatchObject({ kind: 'found', entry: { kind: 'directory' } })
    })

    it('says missing only where the tree read the folder, and unknown in hidden, unread or cut-short folders', () => {
        expect(lookupLinkTarget(index, 'C:\\notes\\docs\\nope.md')).toEqual({ kind: 'missing' })
        expect(lookupLinkTarget(index, 'C:\\notes\\nope\\deeper\\a.md')).toEqual({ kind: 'missing' })
        expect(lookupLinkTarget(index, 'C:\\notes\\my file.md\\inside')).toEqual({ kind: 'missing' })
        expect(lookupLinkTarget(index, 'C:\\notes\\big\\a.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(index, 'C:\\notes\\locked\\a.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(index, 'C:\\notes\\.git\\config')).toEqual({ kind: 'unknown' })
        // A build folder is only left out next to its project file.
        expect(lookupLinkTarget(index, 'C:\\notes\\node_modules\\x\\readme.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(index, 'C:\\notes\\dist\\a.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(buildLinkIndex(ROOT, [file(DOC)]), 'C:\\notes\\dist\\a.md')).toEqual({ kind: 'missing' })
    })

    it('says unknown for a name missing under a folder read through a link, whose own links the tree leaves out', () => {
        // `notes` is a junction; the junction `notes\img` and the symlink `notes\spec.md` inside it aren't listed.
        const linked = buildLinkIndex(ROOT, [
            folder('C:\\notes\\notes', [file('C:\\notes\\notes\\a.md'), folder('C:\\notes\\notes\\deep', [])], { linked: true }),
            folder('C:\\notes\\plain', []),
            file(DOC),
        ])
        expect(lookupLinkTarget(linked, 'C:\\notes\\notes\\a.md')).toMatchObject({ kind: 'found' })
        expect(lookupLinkTarget(linked, 'C:\\notes\\notes\\img\\a.png')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(linked, 'C:\\notes\\notes\\spec.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(linked, 'C:\\notes\\notes\\deep\\x.md')).toEqual({ kind: 'unknown' })
        expect(lookupLinkTarget(linked, 'C:\\notes\\plain\\x.md')).toEqual({ kind: 'missing' })
    })
})

describe('findBrokenLinks', () => {
    it('underlines a relative link, a /-rooted link, an image and a definition that lead nowhere, with a plain message', async () => {
        const source = ['[a](docs/setp.md) [b](/nope/x.md) ![c](assets/chrt.png)', '', '[ref]: missing.md', '', '[r][ref]'].join('\n')
        expect(await broken(source)).toEqual([
            { text: 'docs/setp.md', message: 'No file called docs/setp.md in this folder.' },
            { text: '/nope/x.md', message: 'No file called /nope/x.md in this folder.' },
            { text: 'assets/chrt.png', message: 'No image called assets/chrt.png in this folder.' },
            { text: 'missing.md', message: 'No file called missing.md in this folder.' },
        ])
    })

    it('leaves links that work alone, however they spell the path, folders included', async () => {
        const source = [
            '[a](docs/setup.md) [b](Docs\\Setup.MD) [c](my%20file.md) [d](<my file.md>) [e](a(1).md) [f](a\\)b.md)',
            '[g](docs) [h](docs/) [i](./docs/sub/) [j](/docs/other.md "Title") ![k](assets/chart.png) [l](guide.md)',
            '[m](https://example.com/x.md) [n](mailto:me@example.com) [o](tel:123) <https://x.y> [p](ftp://x)',
            '```',
            '[q](in-code.md)',
            '```',
            '`[r](inline.md)` $[s](math.md)$',
        ].join('\n')
        expect(await broken(source)).toEqual([])
    })

    it('never checks a link outside the open folder or on another computer, and never asks the disk about one', async () => {
        const checkOnDisk = vi.fn(async () => 'missing' as const)
        const source = '[a](../outside.md) [b](C:/elsewhere/x.md) [c](//server/share/x.md) [d](\\\\\\\\server\\\\share\\\\x.md) ![e](../out.png)'
        expect(await broken(source, { checkOnDisk })).toEqual([])
        expect(checkOnDisk).not.toHaveBeenCalled()
    })

    it('checks links in a folder opened from a share', async () => {
        const root = '\\\\server\\share\\notes'
        const tree = [file(`${root}\\a.md`)]
        const source = '[a](a.md) [b](b.md)'
        const found = await broken(source, { workspaceRoot: root, documentPath: `${root}\\doc.md`, index: buildLinkIndex(root, tree) })
        expect(found.map((link) => link.text)).toEqual(['b.md'])
    })

    it('asks the disk once about a path the tree cannot vouch for, and underlines it only when it is really missing', async () => {
        const answers: Record<string, 'file' | 'missing' | 'unknown'> = {
            'C:\\notes\\big\\there.md': 'file',
            'C:\\notes\\big\\gone.md': 'missing',
            'C:\\notes\\locked\\x.md': 'unknown',
        }
        const checkOnDisk = vi.fn(async (path: string) => answers[path] ?? 'missing')
        const source = '[a](big/there.md) [b](big/gone.md) [c](locked/x.md) [d](.git/x.md) [e](docs/setup.md)'
        expect((await broken(source, { checkOnDisk })).map((link) => link.text)).toEqual(['big/gone.md', '.git/x.md'])
        expect(checkOnDisk.mock.calls.map(([path]) => path).sort()).toEqual(
            ['C:\\notes\\.git\\x.md', 'C:\\notes\\big\\gone.md', 'C:\\notes\\big\\there.md', 'C:\\notes\\locked\\x.md'].sort()
        )
    })

    it('underlines #anchors that match no heading, footnote or HTML id, and not #foo--bar, footnotes, # or #top', async () => {
        const source = [
            '# Foo & Bar',
            '',
            'Text[^1] <a name="old"></a> <span id="custom"></span>',
            '',
            '[^1]: Note',
            '',
            '[a](#foo--bar) [b](#fn-1) [c](#fnref-1) [d](#) [e](#TOP) [f](#Old) [g](#custom) [h](#user-content-foo--bar)',
            '[i](#instal) [j](guide.md#nowhere) [k](./guide.md#foo-bar)',
        ].join('\n')
        expect(await broken(source)).toEqual([
            { text: '#instal', message: 'This file has no heading for #instal.' },
            { text: 'guide.md#nowhere', message: 'This file has no heading for #nowhere.' },
        ])
    })

    it('checks another file’s #anchor only while it is open in a tab, using that tab’s text', async () => {
        const tabs = new Map([['C:\\notes\\docs\\other.md', '# Install\n\n## Unsaved heading']])
        const openText = vi.fn((path: string) => [...tabs].find(([key]) => key.toLowerCase() === path.replace(/\//g, '\\').toLowerCase())?.[1])
        const source = '[a](Docs\\Other.MD#install) [b](docs/other.md#unsaved-heading) [c](docs/other.md#gone) [d](docs/Setup.md#anything)'
        expect(await broken(source, { openText })).toEqual([{ text: 'docs/other.md#gone', message: 'other.md has no heading for #gone.' }])
    })

    it('reads the disk zero times for 1,000 links that all resolve in a 50,000-entry tree, and never walks the tree again', async () => {
        // Counts every time a folder's contents are looked at.
        let walks = 0
        const counted = (node: FileNode): FileNode => {
            if (node.kind === 'file') return node
            const children = node.children.map(counted)
            return {
                ...node,
                get children() {
                    walks += 1
                    return children
                },
            }
        }
        const many = Array.from({ length: 50 }, (_, i) =>
            folder(
                `C:\\notes\\f${i}`,
                Array.from({ length: 999 }, (_, j) => file(`C:\\notes\\f${i}\\n${j}.md`))
            )
        )
        const built = buildLinkIndex(ROOT, many.map(counted))
        expect(built.list).toHaveLength(50_000)
        walks = 0
        // The index's list, which a scan would go through, and its map, which a lookup reads a few times.
        let listReads = 0
        let lookups = 0
        const list = new Proxy(built.list, {
            get(target, key, receiver) {
                listReads += 1
                return Reflect.get(target, key, receiver)
            },
        })
        const entries = new Proxy(built.entries, {
            get(target, key) {
                if (key === 'get') {
                    return (path: string) => {
                        lookups += 1
                        return target.get(path)
                    }
                }
                const value = Reflect.get(target, key, target)
                return typeof value === 'function' ? value.bind(target) : value
            },
        })
        const index = { ...built, list, entries }
        const checkOnDisk = vi.fn(async () => 'file' as const)
        const source = Array.from({ length: 1000 }, (_, k) => `[x](f${k % 50}/n${k % 20}.md)`).join('\n')
        expect(await broken(source, { index, checkOnDisk })).toEqual([])
        expect(walks).toBe(0)
        expect(listReads).toBe(0)
        // One map read for each link that is listed.
        expect(lookups).toBe(1000)
        expect(checkOnDisk).not.toHaveBeenCalled()
    })

    it('walks only the missing path’s own names to tell missing from unknown, never the whole list', async () => {
        const built = buildLinkIndex(ROOT, TREE)
        let lookups = 0
        const entries = new Proxy(built.entries, {
            get(target, key) {
                if (key === 'get') {
                    return (path: string) => {
                        lookups += 1
                        return target.get(path)
                    }
                }
                const value = Reflect.get(target, key, target)
                return typeof value === 'function' ? value.bind(target) : value
            },
        })
        const list = new Proxy(built.list, {
            get() {
                throw new Error('the list was read')
            },
        })
        expect(lookupLinkTarget({ ...built, entries, list }, 'C:\\notes\\docs\\sub\\deeper\\gone.md')).toEqual({ kind: 'missing' })
        // The whole path, the root, then docs, sub and deeper: a few reads, however big the tree.
        expect(lookups).toBeLessThanOrEqual(6)
    })

    it('splits an escaped \\# where the preview does, so the message and the fix are about what the link leads to', async () => {
        const source = '## X md\n\n[a](\\#x.md) [b](nope\\#sec.md)'
        const found = await findBrokenLinks(source, documentLinks(source), context())
        expect(found.map((link) => link.message)).toEqual(['This file has no heading for #x.md.', 'No file called nope in this folder.'])
        expect(found.map((link) => source.slice(link.fix.span.start, link.fix.span.end))).toEqual(['x.md', 'nope'])
    })

    it('leaves a link alone when its written address cannot be split as the parsed one', async () => {
        expect(await broken('[a](gone&#35;part.md)')).toEqual([])
    })

    it('marks no more than the cap in one file', async () => {
        const source = Array.from({ length: MAX_LINK_MARKS + 50 }, (_, k) => `[x](gone-${k}.md)`).join('\n')
        expect(await broken(source)).toHaveLength(MAX_LINK_MARKS)
    })

    it('checks links in a document with front matter at the right place', async () => {
        const source = '---\ntitle: T\n---\n\n[a](gone.md)'
        const [link] = await findBrokenLinks(source, documentLinks(source), context())
        expect(source.slice(link!.span.start, link!.span.end)).toBe('gone.md')
    })
})

describe('checkLinkTarget', () => {
    it('asks once, keeps the answer, and asks again once it is forgotten (the window got focus)', async () => {
        const missing = Object.assign(new Error('No such file (os error 2)'))
        let exists = false
        const readKind = vi.fn(async () => {
            if (!exists) throw missing
            return 'file' as const
        })
        const listener = vi.fn()
        const stop = subscribeLinkTargets(listener)
        expect(await checkLinkTarget('C:\\notes\\.hidden\\new.md', readKind)).toBe('missing')
        expect(await checkLinkTarget('c:/notes/.HIDDEN/new.md', readKind)).toBe('missing')
        expect(readKind).toHaveBeenCalledTimes(1)

        exists = true
        forgetLinkTargets()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(await checkLinkTarget('C:\\notes\\.hidden\\new.md', readKind)).toBe('file')
        expect(readKind).toHaveBeenCalledTimes(2)
        stop()
    })

    it('asks the disk about a few paths at a time, however many links a page has', async () => {
        let running = 0
        let most = 0
        const readKind = vi.fn(async () => {
            running += 1
            most = Math.max(most, running)
            await new Promise((resolve) => setTimeout(resolve, 1))
            running -= 1
            return 'file' as const
        })
        const checkOnDisk = (path: string) => checkLinkTarget(path, readKind)
        const source = Array.from({ length: 200 }, (_, k) => `[x](.cache/page-${k}.md)`).join('\n')
        expect(await broken(source, { checkOnDisk })).toEqual([])
        expect(readKind).toHaveBeenCalledTimes(200)
        expect(most).toBe(MAX_PARALLEL_READS)
    })

    it('forgets the answers inside a changed folder only, and says unknown when the disk fails another way', async () => {
        const readKind = vi.fn(async (path: string) => {
            if (path.includes('denied')) throw new Error('Access is denied. (os error 5)')
            return 'file' as const
        })
        expect(await checkLinkTarget('C:\\notes\\denied\\a.md', readKind)).toBe('unknown')
        await checkLinkTarget('C:\\notes\\a\\x.md', readKind)
        await checkLinkTarget('C:\\notes\\b\\y.md', readKind)
        forgetLinkTargets(['C:\\notes\\A'])
        await checkLinkTarget('C:\\notes\\a\\x.md', readKind)
        await checkLinkTarget('C:\\notes\\b\\y.md', readKind)
        expect(readKind.mock.calls.map(([path]) => path)).toEqual([
            'C:\\notes\\denied\\a.md',
            'C:\\notes\\a\\x.md',
            'C:\\notes\\b\\y.md',
            'C:\\notes\\a\\x.md',
        ])
    })
})

describe('a newly created file in a hidden folder', () => {
    it('loses its underline once the window gets focus again', async () => {
        let exists = false
        const readKind = async () => {
            if (!exists) throw new Error('not found (os error 2)')
            return 'file' as const
        }
        const checkOnDisk = (path: string) => checkLinkTarget(path, readKind)
        const source = '[a](.cache/new.md)'
        expect(await broken(source, { checkOnDisk })).toHaveLength(1)
        exists = true
        // Still the kept answer until focus comes back.
        expect(await broken(source, { checkOnDisk })).toHaveLength(1)
        forgetLinkTargets()
        expect(await broken(source, { checkOnDisk })).toEqual([])
    })
})

describe('findBrokenLinks with wiki links', () => {
    const LISTED: FileNode[] = TREE.filter((node) => node.kind === 'file' || (!node.truncated && !node.unreadable))
    const wiki = { wikiIndex: buildWikiIndex(ROOT, LISTED), index: buildLinkIndex(ROOT, LISTED) }

    it('underlines the target of a wiki link the lookup can’t find, in order with the other links, and leaves the rest alone', async () => {
        const source = '[[Nowhere|label]] [[setup]] [[docs/other.md#Part]] [gone](gone.md) [[#Intro]] [[../outside]]'
        expect(await broken(source, wiki)).toEqual([
            { text: 'Nowhere', message: 'No note called Nowhere in this folder.' },
            { text: 'gone.md', message: 'No file called gone.md in this folder.' },
            { text: '../outside', message: 'No note called ../outside in this folder.' },
        ])
    })

    it('checks [[a]] as a wiki link when the document defines [a], and never wiki links in code', async () => {
        const source = 'See [[a]] and `[[b]]`.\n\n```\n[[c]]\n```\n\n[a]: docs/Setup.md'
        expect(await broken(source, wiki)).toEqual([{ text: 'a', message: 'No note called a in this folder.' }])
    })

    it('leaves a note the tree may not list, and every wiki link without a folder, alone', async () => {
        expect(await broken('[[Nowhere]]', { wikiIndex: buildWikiIndex(ROOT, TREE) })).toEqual([])
        expect(await broken('[[Nowhere]]', { wikiIndex: null })).toEqual([])
        expect(await broken('[[Nowhere]]')).toEqual([])
    })

    it('offers no fix of its own for a missing note', async () => {
        const [mark] = await findBrokenLinks('[[Nowhere]]', documentLinks('[[Nowhere]]'), context(wiki))
        expect(mark!.fix).toEqual({ kind: 'note', span: { start: 2, end: 9 } })
    })
})
