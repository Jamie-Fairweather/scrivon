import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { buildWikiIndex, resolveWikiTarget, wikiIndexFor, wikiNameClashes, wikiTargetFor } from '@/lib/workspace/wiki-link-lookup'

const ROOT = 'C:\\notes'

function file(path: string): FileNode {
    return { kind: 'file', name: path.split('\\').at(-1)!, path: `${ROOT}\\${path}` }
}

function folder(path: string, children: FileNode[], extra: Partial<Extract<FileNode, { kind: 'directory' }>> = {}): FileNode {
    return { kind: 'directory', name: path.split('\\').at(-1)!, path: `${ROOT}\\${path}`, children, ...extra }
}

const TREE: FileNode[] = [
    folder('projects', [file('projects\\Plan.md'), file('projects\\Ideas.md'), folder('projects\\deep', [file('projects\\deep\\Ideas.md')])]),
    folder('zeta', [file('zeta\\Ideas.md')]),
    folder('beta', [file('beta\\Ideas.md')]),
    file('Home.md'),
    file('Readme.markdown'),
    file('diagram.mmd'),
]

const index = buildWikiIndex(ROOT, TREE)

function lookup(target: string, documentPath: string | null = `${ROOT}\\Home.md`, within = index) {
    const found = resolveWikiTarget(within, target, documentPath)
    return found.kind === 'found' ? found.path.slice(ROOT.length + 1) : found.kind
}

describe('resolveWikiTarget', () => {
    it('finds a note by its name anywhere in the folder, in any case, with or without .md or .markdown', () => {
        expect(lookup('Plan')).toBe('projects\\Plan.md')
        expect(lookup('plan')).toBe('projects\\Plan.md')
        expect(lookup('PLAN.MD')).toBe('projects\\Plan.md')
        expect(lookup('Readme')).toBe('Readme.markdown')
        expect(lookup('readme.markdown')).toBe('Readme.markdown')
        expect(lookup('  Home  ')).toBe('Home.md')
    })

    it('reads a target with / or \\ as a path from the open folder', () => {
        expect(lookup('projects/Plan')).toBe('projects\\Plan.md')
        expect(lookup('Projects\\deep\\IDEAS')).toBe('projects\\deep\\Ideas.md')
        expect(lookup('/projects/Plan.md')).toBe('projects\\Plan.md')
        expect(lookup('projects/./deep/../Plan')).toBe('projects\\Plan.md')
        // Only from the open folder, not from the end of a path.
        expect(lookup('deep/Ideas')).toBe('missing')
    })

    it('settles a clash by the document’s own folder, then the shortest path, then A to Z', () => {
        expect(lookup('Ideas', `${ROOT}\\projects\\deep\\Notes.md`)).toBe('projects\\deep\\Ideas.md')
        expect(lookup('Ideas', `${ROOT}\\zeta\\Other.md`)).toBe('zeta\\Ideas.md')
        expect(lookup('Ideas', `${ROOT}\\projects\\Plan.md`)).toBe('projects\\Ideas.md')
        // From the top: beta/Ideas and zeta/Ideas are shorter than projects/Ideas, and as long as each other.
        expect(lookup('Ideas', `${ROOT}\\Home.md`)).toBe('beta\\Ideas.md')
    })

    it('starts from the folder’s top for a document with no folder of its own', () => {
        expect(lookup('Ideas', null)).toBe('beta\\Ideas.md')
        expect(lookup('Ideas', 'D:\\elsewhere\\x.md')).toBe('beta\\Ideas.md')
        const withTop = buildWikiIndex(ROOT, [folder('projects', [file('projects\\Plan.md'), file('projects\\Home.md')]), file('Home.md')])
        expect(lookup('Home', null, withTop)).toBe('Home.md')
        expect(lookup('Home', `${ROOT}\\projects\\Plan.md`, withTop)).toBe('projects\\Home.md')
    })

    it('never leads outside the open folder: .., drive letters and network shares are missing', () => {
        expect(lookup('../secret')).toBe('missing')
        expect(lookup('projects/../../Home')).toBe('missing')
        expect(lookup('C:\\notes\\Home')).toBe('missing')
        expect(lookup('c:/notes/Home.md')).toBe('missing')
        expect(lookup('\\\\server\\share\\Home')).toBe('missing')
        expect(lookup('//server/share/Home')).toBe('missing')
    })

    it('finds no note for other files, an empty name or one nothing has', () => {
        expect(lookup('diagram')).toBe('missing')
        expect(lookup('Nowhere')).toBe('missing')
        expect(lookup('.md')).toBe('missing')
        expect(lookup('/')).toBe('missing')
    })

    it('says a note may be there when the tree was cut short or has folders it couldn’t read', () => {
        const truncated = buildWikiIndex(ROOT, [...TREE, folder('big', [], { truncated: true })])
        const unreadable = buildWikiIndex(ROOT, [folder('locked', [], { unreadable: true }), file('Home.md')])
        expect(truncated.incomplete).toBe(true)
        expect(lookup('Nowhere', null, truncated)).toBe('unlisted')
        expect(lookup('big/Nowhere', null, unreadable)).toBe('unlisted')
        expect(lookup('Plan', null, truncated)).toBe('projects\\Plan.md')
        // Still never outside the folder.
        expect(lookup('../Nowhere', null, truncated)).toBe('missing')
        expect(index.incomplete).toBe(false)
    })
})

describe('wikiTargetFor and wikiNameClashes', () => {
    it('inserts the name when it leads to the note, else its path from the folder', () => {
        const ideas = index.notes.filter((note) => note.name === 'Ideas')
        expect(ideas.map((note) => wikiTargetFor(index, note, `${ROOT}\\zeta\\Other.md`))).toEqual([
            'projects/Ideas',
            'projects/deep/Ideas',
            'Ideas',
            'beta/Ideas',
        ])
        expect(wikiNameClashes(index, ideas[0]!)).toBe(true)
        expect(
            wikiNameClashes(
                index,
                index.notes.find((note) => note.name === 'Plan')!
            )
        ).toBe(false)
    })

    it('builds the index once for each tree', () => {
        expect(wikiIndexFor(ROOT, TREE)).toBe(wikiIndexFor(ROOT, TREE))
        expect(wikiIndexFor(ROOT, TREE)).not.toBe(wikiIndexFor('D:\\other', TREE))
    })
})
