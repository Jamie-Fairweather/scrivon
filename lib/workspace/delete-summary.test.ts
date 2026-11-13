import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { describeDelete } from './delete-summary'

const file = (path: string): FileNode => ({ kind: 'file', name: path.split('\\').at(-1)!, path })
const folder = (path: string, children: FileNode[], extra: Partial<Extract<FileNode, { kind: 'directory' }>> = {}): FileNode => ({
    kind: 'directory',
    name: path.split('\\').at(-1)!,
    path,
    children,
    ...extra,
})
const tab = (path: string, isDirty = false) => ({ path, name: path.split('\\').at(-1)!, isDirty })

describe('describeDelete', () => {
    it('names a file by where it is in the opened folder', () => {
        expect(describeDelete(file('C:\\ws\\docs\\README.md'), 'C:\\ws', [])).toEqual({
            title: 'Delete file?',
            isDirectory: false,
            path: 'docs\\README.md',
            contents: null,
            closingTabs: null,
            unsaved: null,
        })
    })

    it('uses the full path when there is no opened folder to go by', () => {
        expect(describeDelete(file('C:\\other\\a.md'), 'C:\\ws', []).path).toBe('C:\\other\\a.md')
        expect(describeDelete(file('C:\\other\\a.md'), null, []).path).toBe('C:\\other\\a.md')
    })

    it('counts the files anywhere inside a folder', () => {
        const docs = folder('C:\\ws\\docs', [
            file('C:\\ws\\docs\\a.md'),
            folder('C:\\ws\\docs\\img', [file('C:\\ws\\docs\\img\\x.png'), file('C:\\ws\\docs\\img\\y.png')]),
        ])

        const summary = describeDelete(docs, 'C:\\ws', [])

        expect(summary).toMatchObject({ title: 'Delete folder?', isDirectory: true, path: 'docs' })
        expect(summary.contents).toBe('It has 3 files in it.')
    })

    it('says when a folder has one file or none', () => {
        expect(describeDelete(folder('C:\\ws\\a', [file('C:\\ws\\a\\x.md')]), 'C:\\ws', []).contents).toBe('It has 1 file in it.')
        expect(describeDelete(folder('C:\\ws\\a', [folder('C:\\ws\\a\\b', [])]), 'C:\\ws', []).contents).toBe('It has no files in it.')
    })

    it("says 'at least' when part of the folder couldn't be listed", () => {
        const big = folder('C:\\ws\\big', [file('C:\\ws\\big\\a.md'), folder('C:\\ws\\big\\more', [], { truncated: true })])
        const locked = folder('C:\\ws\\locked', [], { unreadable: true })

        expect(describeDelete(big, 'C:\\ws', []).contents).toBe('It has at least 1 file in it.')
        expect(describeDelete(locked, 'C:\\ws', []).contents).toBe("Scrivon couldn't see what is in it.")
    })

    it('names the open tab that will close', () => {
        expect(describeDelete(file('C:\\ws\\a.md'), 'C:\\ws', [tab('C:\\ws\\a.md')]).closingTabs).toBe('Closes its open tab.')
    })

    it('names the open tabs inside a folder by where they are in it', () => {
        const docs = folder('C:\\ws\\docs', [])
        const tabs = [tab('C:\\ws\\docs\\README.md'), tab('C:\\ws\\docs\\guide\\README.md')]

        expect(describeDelete(docs, 'C:\\ws', tabs).closingTabs).toBe('Closes 2 open tabs: README.md and guide\\README.md.')
    })

    it('keeps Hebrew or Arabic folder names in tab paths in order on screen', () => {
        const docs = folder('C:\\ws\\docs', [])
        const tabs = [tab('C:\\ws\\docs\\מסמכים\\פרויקט.md', true)]
        const lrm = '\u200E'
        const shown = `${lrm}מסמכים\\${lrm}פרויקט.md${lrm}`

        const summary = describeDelete(docs, 'C:\\ws', tabs)

        expect(summary.closingTabs).toBe(`Closes 1 open tab: ${shown}.`)
        expect(summary.unsaved).toBe(`Unsaved changes in ${shown} will be lost.`)
    })

    it('keeps a long list of tabs short', () => {
        const tabs = ['a', 'b', 'c', 'd', 'e'].map((name) => tab(`C:\\ws\\docs\\${name}.md`))

        expect(describeDelete(folder('C:\\ws\\docs', []), 'C:\\ws', tabs).closingTabs).toBe('Closes 5 open tabs: a.md, b.md, c.md and 2 more.')
    })

    it('warns about unsaved changes that will be lost', () => {
        const docs = folder('C:\\ws\\docs', [])

        expect(describeDelete(file('C:\\ws\\a.md'), 'C:\\ws', [tab('C:\\ws\\a.md', true)]).unsaved).toBe('Its unsaved changes will be lost.')
        expect(describeDelete(docs, 'C:\\ws', [tab('C:\\ws\\docs\\a.md', true), tab('C:\\ws\\docs\\b.md')]).unsaved).toBe(
            'Unsaved changes in a.md will be lost.'
        )
        expect(describeDelete(docs, 'C:\\ws', [tab('C:\\ws\\docs\\a.md', true), tab('C:\\ws\\docs\\b.md', true)]).unsaved).toBe(
            'Unsaved changes in a.md and b.md will be lost.'
        )
    })
})
