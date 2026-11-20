import { describe, expect, it } from 'vitest'
import type { GitEntry } from '@/lib/tauri/git'
import { entryMark, GIT_MARK_LABELS, gitChangesFrom, gitRowMark, NO_GIT_CHANGES } from '@/lib/workspace/git-status'

const changed = (xy: string, path: string): GitEntry => ({ kind: 'changed', xy, path, dir: false })
const untracked = (path: string, dir = false): GitEntry => ({ kind: 'untracked', xy: '??', path, dir })

describe('entryMark', () => {
    it('reads the letters git writes for each kind of change', () => {
        expect(entryMark(changed('.M', 'a.md'))).toBe('M')
        expect(entryMark(changed('M.', 'a.md'))).toBe('M')
        expect(entryMark(changed('MM', 'a.md'))).toBe('M')
        // A type change (a file became a link) is a change too.
        expect(entryMark(changed('.T', 'a.md'))).toBe('M')
        expect(entryMark(changed('A.', 'a.md'))).toBe('A')
        expect(entryMark(changed('AM', 'a.md'))).toBe('A')
        expect(entryMark(changed('.D', 'a.md'))).toBe('D')
        expect(entryMark(changed('D.', 'a.md'))).toBe('D')
        // Added, then deleted from the disk: there is no row for it.
        expect(entryMark(changed('AD', 'a.md'))).toBe('D')
        expect(entryMark({ kind: 'renamed', xy: 'R.', path: 'b.md', from: 'a.md', dir: false })).toBe('R')
        expect(entryMark({ kind: 'renamed', xy: 'RM', path: 'b.md', from: 'a.md', dir: false })).toBe('R')
        expect(entryMark({ kind: 'renamed', xy: 'C.', path: 'b.md', from: 'a.md', dir: false })).toBe('A')
        expect(entryMark({ kind: 'renamed', xy: 'RD', path: 'b.md', from: 'a.md', dir: false })).toBe('D')
        expect(entryMark({ kind: 'unmerged', xy: 'UU', path: 'a.md', dir: false })).toBe('C')
        expect(entryMark({ kind: 'unmerged', xy: 'AA', path: 'a.md', dir: false })).toBe('C')
        expect(entryMark(untracked('a.md'))).toBe('U')
    })
})

describe('gitChangesFrom and gitRowMark', () => {
    const root = 'C:\\ws'

    it('gives each changed file its letter, and nothing to the rest', () => {
        const changes = gitChangesFrom(root, [
            changed('.M', 'docs/a b.md'),
            changed('A.', 'new.md'),
            untracked('loose.md'),
            { kind: 'renamed', xy: 'R.', path: 'kept.md', from: 'keep.md', dir: false },
            { kind: 'unmerged', xy: 'UU', path: 'clash.md', dir: false },
        ])

        expect(gitRowMark(changes, 'C:\\ws\\docs\\a b.md', 'file')).toBe('M')
        expect(gitRowMark(changes, 'C:\\ws\\new.md', 'file')).toBe('A')
        expect(gitRowMark(changes, 'C:\\ws\\loose.md', 'file')).toBe('U')
        expect(gitRowMark(changes, 'C:\\ws\\kept.md', 'file')).toBe('R')
        expect(gitRowMark(changes, 'C:\\ws\\clash.md', 'file')).toBe('C')
        expect(gitRowMark(changes, 'C:\\ws\\same.md', 'file')).toBe('')
        expect(gitRowMark(NO_GIT_CHANGES, 'C:\\ws\\new.md', 'file')).toBe('')
    })

    it('puts a dot on every folder above a change, a deleted file or a rename’s old place included', () => {
        const changes = gitChangesFrom(root, [
            changed('.D', 'gone/deep/old.md'),
            changed('.M', 'docs/a.md'),
            { kind: 'renamed', xy: 'R.', path: 'b.md', from: 'moved/a.md', dir: false },
        ])

        expect(gitRowMark(changes, 'C:\\ws\\gone', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\gone\\deep', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\docs', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\moved', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\clean', 'directory')).toBe('')
        // A deleted file has no row, and no letter.
        expect(gitRowMark(changes, 'C:\\ws\\gone\\deep\\old.md', 'file')).toBe('')
    })

    it('marks everything in an untracked folder U, though git lists only the folder', () => {
        const changes = gitChangesFrom(root, [untracked('fresh', true)])

        expect(gitRowMark(changes, 'C:\\ws\\fresh', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\fresh\\a.md', 'file')).toBe('U')
        expect(gitRowMark(changes, 'C:\\ws\\fresh\\inner\\b.mmd', 'file')).toBe('U')
        expect(gitRowMark(changes, 'C:\\ws\\fresh\\inner', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\freshly.md', 'file')).toBe('')
    })

    it('marks every row U when the open folder itself is untracked', () => {
        const changes = gitChangesFrom(root, [untracked('', true)])

        expect(gitRowMark(changes, 'C:\\ws\\a.md', 'file')).toBe('U')
        expect(gitRowMark(changes, 'C:\\ws\\docs', 'directory')).toBe('changes')
    })

    it('matches paths in any letter case on Windows, and exactly elsewhere', () => {
        const windows = gitChangesFrom('C:\\Work\\Notes', [changed('.M', 'Docs/Read Me.md'), untracked('New', true)])
        expect(gitRowMark(windows, 'c:\\work\\notes\\docs\\read me.md', 'file')).toBe('M')
        expect(gitRowMark(windows, 'C:/Work/Notes/DOCS', 'directory')).toBe('changes')
        expect(gitRowMark(windows, 'C:\\WORK\\NOTES\\new\\x.md', 'file')).toBe('U')

        const posix = gitChangesFrom('/home/me/notes', [changed('.M', 'Docs/a.md')])
        expect(gitRowMark(posix, '/home/me/notes/Docs/a.md', 'file')).toBe('M')
        expect(gitRowMark(posix, '/home/me/notes/docs/a.md', 'file')).toBe('')
    })

    it('shows the strongest letter when git lists a path twice', () => {
        const changes = gitChangesFrom(root, [changed('D.', 'a.md'), untracked('a.md'), { kind: 'unmerged', xy: 'UU', path: 'b.md', dir: false }, changed('.M', 'b.md')])

        expect(gitRowMark(changes, 'C:\\ws\\a.md', 'file')).toBe('U')
        expect(gitRowMark(changes, 'C:\\ws\\b.md', 'file')).toBe('C')
    })

    it('puts a dot on a submodule whose commit moved', () => {
        const changes = gitChangesFrom(root, [changed('.M', 'vendor/lib')])

        expect(gitRowMark(changes, 'C:\\ws\\vendor\\lib', 'directory')).toBe('changes')
        expect(gitRowMark(changes, 'C:\\ws\\vendor', 'directory')).toBe('changes')
    })

    it('gives the same key for the same changes, so a refresh that changes nothing draws nothing', () => {
        const entries = [changed('.M', 'a.md')]
        expect(gitChangesFrom(root, entries).key).toBe(gitChangesFrom(root, [changed('.M', 'a.md')]).key)
        expect(gitChangesFrom(root, entries).key).not.toBe(gitChangesFrom(root, [changed('A.', 'a.md')]).key)
        expect(gitChangesFrom(root, [])).toBe(NO_GIT_CHANGES)
    })

    it('says each mark in words', () => {
        expect(GIT_MARK_LABELS).toEqual({
            M: 'Modified',
            A: 'Added',
            U: 'Untracked',
            R: 'Renamed',
            C: 'Conflicted',
            changes: 'Contains changes',
        })
    })
})
