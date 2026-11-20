import { describe, expect, it } from 'vitest'
import { buildLinkIndex } from '@/lib/workspace/link-index'
import { closeAnchors, closeLinkTargets, MAX_LINK_SUGGESTIONS } from '@/lib/workspace/link-suggestions'
import type { FileNode } from '@/lib/workspace/types'

const ROOT = 'C:\\notes'
const file = (path: string): FileNode => ({ kind: 'file', name: path.slice(path.lastIndexOf('\\') + 1), path })
const folder = (path: string, children: FileNode[]): FileNode => ({ kind: 'directory', name: path.slice(path.lastIndexOf('\\') + 1), path, children })

const TREE: FileNode[] = [
    folder('C:\\notes\\docs', [file('C:\\notes\\docs\\set-up.md'), file('C:\\notes\\docs\\setup.png'), file('C:\\notes\\docs\\install.md')]),
    folder('C:\\notes\\archive', [file('C:\\notes\\archive\\setup.md')]),
    folder('C:\\notes\\assets', [file('C:\\notes\\assets\\chart.png'), file('C:\\notes\\assets\\chart-notes.md')]),
    folder('C:\\notes\\guides', []),
    file('C:\\notes\\readme.md'),
]
const index = buildLinkIndex(ROOT, TREE)
const DOC = 'C:\\notes\\readme.md'

describe('closeLinkTargets', () => {
    it('puts files nearby in the folder first, of the link’s kind', () => {
        const found = closeLinkTargets(index, 'C:\\notes\\docs\\setup.md', { wanted: 'document', documentPath: DOC })
        expect(found[0]).toBe('C:\\notes\\docs\\set-up.md')
        expect(found).toContain('C:\\notes\\archive\\setup.md')
        // A picture with the same name is not what a link to a document meant.
        expect(found).not.toContain('C:\\notes\\docs\\setup.png')
    })

    it('offers pictures for an image, and never folders', () => {
        const found = closeLinkTargets(index, 'C:\\notes\\assets\\chrt.png', { wanted: 'image', documentPath: DOC })
        expect(found[0]).toBe('C:\\notes\\assets\\chart.png')
        expect(found).not.toContain('C:\\notes\\assets')
    })

    it('offers folders for a link, catches a typo or two, and never offers the document itself', () => {
        expect(closeLinkTargets(index, 'C:\\notes\\guide', { wanted: 'document', documentPath: DOC })).toContain('C:\\notes\\guides')
        expect(closeLinkTargets(index, 'C:\\notes\\docs\\instlal.md', { wanted: 'document', documentPath: DOC })[0]).toBe(
            'C:\\notes\\docs\\install.md'
        )
        expect(closeLinkTargets(index, 'C:\\notes\\readm.md', { wanted: 'document', documentPath: DOC })).not.toContain(DOC)
    })

    it('offers at most five', () => {
        const many = buildLinkIndex(
            ROOT,
            Array.from({ length: 20 }, (_, i) => file(`C:\\notes\\note-${i}.md`))
        )
        expect(closeLinkTargets(many, 'C:\\notes\\note.md', { wanted: 'document', documentPath: DOC })).toHaveLength(MAX_LINK_SUGGESTIONS)
    })
})

describe('closeAnchors', () => {
    it('ranks headings closest to the fragment first, footnotes after', () => {
        const ids = ['intro', 'installation', 'install-on-windows', 'fn-install', 'usage']
        expect(closeAnchors(ids, 'install')[0]).toBe('installation')
        expect(closeAnchors(ids, 'install')).toEqual(['installation', 'install-on-windows', 'fn-install'])
        expect(closeAnchors(ids, 'usgae')).toEqual(['usage'])
        expect(closeAnchors(ids, 'zzz')).toEqual([])
    })
})
