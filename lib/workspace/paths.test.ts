import { describe, expect, it } from 'vitest'
import {
    changeAltersTree,
    childrenOf,
    collectFileNames,
    collectFilePaths,
    collectUnreadableFolders,
    entryNameError,
    findNameClash,
    findNodeByPath,
    folderLabels,
    isTreeTruncated,
    keepUnchangedNodes,
    nameTakenMessage,
    shortenPath,
    uniqueFileName,
    uniqueNewName,
    validateFileName,
} from './paths'
import type { FileNode } from './types'

const sampleTree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [
            { kind: 'file', name: 'readme.md', path: '/ws/docs/readme.md' },
            { kind: 'file', name: 'diagram.mmd', path: '/ws/docs/diagram.mmd' },
        ],
    },
    { kind: 'file', name: 'root.mmd', path: '/ws/root.mmd' },
]

describe('validateFileName', () => {
    it('rejects empty names', () => {
        expect(validateFileName('')).toBe('Name cannot be empty')
        expect(validateFileName('   ')).toBe('Name cannot be empty')
    })

    it('rejects invalid characters', () => {
        expect(validateFileName('bad<file>.mmd')).toBe('Name contains invalid characters')
        expect(validateFileName('file|name.mmd')).toBe('Name contains invalid characters')
    })

    it('rejects dot names and path separators', () => {
        expect(validateFileName('.')).toBe('Invalid name')
        expect(validateFileName('..')).toBe('Invalid name')
        expect(validateFileName('folder/file.mmd')).toBe('Name cannot contain path separators')
        expect(validateFileName('folder\\file.mmd')).toBe('Name cannot contain path separators')
    })

    it('rejects names Windows reserves for devices, with or without an extension', () => {
        expect(validateFileName('con')).toBe('"con" is a reserved name on Windows')
        expect(validateFileName('AUX')).toBe('"AUX" is a reserved name on Windows')
        expect(validateFileName('nul.md')).toBe('"nul" is a reserved name on Windows')
        expect(validateFileName('COM1.mmd')).toBe('"COM1" is a reserved name on Windows')
        expect(validateFileName('lpt9')).toBe('"lpt9" is a reserved name on Windows')
        expect(validateFileName('console.md')).toBeNull()
        expect(validateFileName('com10.md')).toBeNull()
    })

    it('rejects a trailing dot, which Windows would drop', () => {
        expect(validateFileName('drafts.')).toBe('Name cannot end with a dot')
        expect(validateFileName('...')).toBe('Name cannot end with a dot')
    })

    it('rejects names longer than Windows allows', () => {
        expect(validateFileName(`${'a'.repeat(252)}.md`)).toBeNull()
        expect(validateFileName(`${'a'.repeat(253)}.md`)).toBe('Name is too long (255 characters at most)')
    })

    it('accepts valid names', () => {
        expect(validateFileName('diagram.mmd')).toBeNull()
        expect(validateFileName('  notes.md  ')).toBeNull()
    })
})

describe('uniqueFileName', () => {
    it('returns the base name when unused', () => {
        expect(uniqueFileName('doc.mmd', new Set(['other.mmd']))).toBe('doc.mmd')
    })

    it('appends copy suffixes', () => {
        const existing = new Set(['doc.mmd', 'doc copy.mmd'])
        expect(uniqueFileName('doc.mmd', existing)).toBe('doc copy 2.mmd')
    })

    it('ignores letter case, so it never picks a name Windows sees as taken', () => {
        expect(uniqueFileName('notes.md', ['notes.md', 'Notes Copy.md'])).toBe('notes copy 2.md')
    })

    it('handles names without extension', () => {
        const existing = new Set(['README'])
        expect(uniqueFileName('README', existing)).toBe('README copy')
    })
})

describe('uniqueNewName', () => {
    it('keeps the name when nothing uses it', () => {
        expect(uniqueNewName('diagram.mmd', ['notes.md'])).toBe('diagram.mmd')
    })

    it('numbers the name past every taken one, ignoring letter case', () => {
        expect(uniqueNewName('diagram.mmd', ['Diagram.mmd', 'diagram 2.MMD'])).toBe('diagram 3.mmd')
    })

    it('numbers names without an extension', () => {
        expect(uniqueNewName('diagrams', ['diagrams'])).toBe('diagrams 2')
    })
})

describe('folderLabels', () => {
    it('labels folders by name, adding where they are only when two share a name', () => {
        expect(folderLabels(['C:\\work\\docs', 'D:\\personal\\Docs', 'C:\\work\\notes'])).toEqual([
            { path: 'C:\\work\\docs', name: 'docs', location: 'C:\\work' },
            { path: 'D:\\personal\\Docs', name: 'Docs', location: 'D:\\personal' },
            { path: 'C:\\work\\notes', name: 'notes', location: null },
        ])
    })

    it('names a drive root by its path', () => {
        expect(folderLabels(['E:\\'])).toEqual([{ path: 'E:\\', name: 'E:\\', location: null }])
    })
})

describe('shortenPath', () => {
    it('leaves a short path as it is', () => {
        expect(shortenPath('C:\\work\\docs')).toBe('C:\\work\\docs')
    })

    it('keeps the start and end of a long path', () => {
        expect(shortenPath('abcdefghij', 6, 2, 3)).toBe('ab…hij')
    })

    it('never cuts an emoji in half', () => {
        const path = `C:\\${'😀'.repeat(10)}`
        const short = shortenPath(path, 6, 4, 2)
        expect(short).toBe('C:\\😀…😀😀')
        expect(short).not.toContain('\uFFFD')
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(short)).toBe(false)
    })
})

describe('collectFilePaths', () => {
    it('collects all file paths in the tree', () => {
        expect(collectFilePaths(sampleTree)).toEqual(new Set(['/ws/docs/readme.md', '/ws/docs/diagram.mmd', '/ws/root.mmd']))
    })
})

describe('collectFileNames', () => {
    it('collects all node names including directories', () => {
        expect(collectFileNames(sampleTree)).toEqual(new Set(['docs', 'readme.md', 'diagram.mmd', 'root.mmd']))
    })
})

describe('collectUnreadableFolders', () => {
    it('finds folders that could not be read, at any depth', () => {
        const locked = { kind: 'directory' as const, name: 'locked', path: '/ws/docs/locked', children: [], unreadable: true as const }
        const tree = [{ kind: 'directory' as const, name: 'docs', path: '/ws/docs', children: [locked] }, ...sampleTree]
        expect(collectUnreadableFolders(tree)).toEqual([locked])
        expect(collectUnreadableFolders(sampleTree)).toEqual([])
    })
})

describe('keepUnchangedNodes', () => {
    const copy = (nodes: FileNode[]): FileNode[] => structuredClone(nodes)

    it('keeps the tree shown now when a new read found no change', () => {
        expect(keepUnchangedNodes(sampleTree, copy(sampleTree))).toBe(sampleTree)
    })

    it('keeps unchanged folders and files, and uses the new ones only where something changed', () => {
        const next = copy(sampleTree)
        const docs = next[0] as Extract<FileNode, { kind: 'directory' }>
        docs.children.push({ kind: 'file', name: 'zz.md', path: '/ws/docs/zz.md' })

        const merged = keepUnchangedNodes(sampleTree, next)

        expect(merged).not.toBe(sampleTree)
        expect(merged).toEqual(next)
        // root.mmd didn't change; docs did, but its two old files are still the same objects.
        expect(merged[1]).toBe(sampleTree[1])
        const mergedDocs = merged[0] as Extract<FileNode, { kind: 'directory' }>
        const oldDocs = sampleTree[0] as Extract<FileNode, { kind: 'directory' }>
        expect(mergedDocs).not.toBe(oldDocs)
        expect(mergedDocs.children[0]).toBe(oldDocs.children[0])
    })

    it('notices a removed entry, a renamed one and a folder that became unreadable', () => {
        expect(keepUnchangedNodes(sampleTree, copy(sampleTree).slice(0, 1))).toEqual(sampleTree.slice(0, 1))
        const renamed = copy(sampleTree)
        renamed[1] = { kind: 'file', name: 'Root.mmd', path: '/ws/root.mmd' }
        expect(keepUnchangedNodes(sampleTree, renamed)[1]).toBe(renamed[1])
        const locked = copy(sampleTree)
        locked[0] = { kind: 'directory', name: 'docs', path: '/ws/docs', children: [], unreadable: true }
        expect(keepUnchangedNodes(sampleTree, locked)[0]).toEqual(locked[0])
    })

    it('notices a folder that was left unread, or is read in full again', () => {
        const empty: FileNode[] = [{ kind: 'directory', name: 'docs', path: '/ws/docs', children: [] }]
        const cut: FileNode[] = [{ kind: 'directory', name: 'docs', path: '/ws/docs', children: [], truncated: true }]
        expect(keepUnchangedNodes(empty, cut)[0]).toBe(cut[0])
        expect(keepUnchangedNodes(cut, empty)[0]).toBe(empty[0])
    })
})

describe('isTreeTruncated', () => {
    it('finds a folder left unread at any depth', () => {
        const cut = { kind: 'directory' as const, name: 'deep', path: '/ws/docs/deep', children: [], truncated: true as const }
        expect(isTreeTruncated([{ kind: 'directory', name: 'docs', path: '/ws/docs', children: [cut] }, ...sampleTree])).toBe(true)
        expect(isTreeTruncated(sampleTree)).toBe(false)
    })
})

describe('changeAltersTree', () => {
    const none: string[] = []

    it('reads the folder again for a new entry in a folder the tree lists, or a listed entry that went', () => {
        expect(changeAltersTree(sampleTree, '/ws', { added: ['/ws/new.md'], removed: none })).toBe(true)
        expect(changeAltersTree(sampleTree, '/ws', { added: ['/ws/docs/new.md'], removed: none })).toBe(true)
        expect(changeAltersTree(sampleTree, '/ws', { added: none, removed: ['/ws/docs/readme.md'] })).toBe(true)
    })

    it("doesn't for a file saved where it already was, or for paths the tree doesn't show", () => {
        // A save replaces the file: it 'appears' where it already was.
        expect(changeAltersTree(sampleTree, '/ws', { added: ['/ws/root.mmd'], removed: none })).toBe(false)
        // Inside a folder the tree leaves out (build output next to its project file, say).
        expect(changeAltersTree(sampleTree, '/ws', { added: ['/ws/dist/app.js'], removed: ['/ws/dist/old.js'] })).toBe(false)
        expect(changeAltersTree(sampleTree, '/ws', { added: none, removed: none })).toBe(false)
    })

    it('ignores letter case in Windows paths, and changes inside a folder that could not be read', () => {
        const tree: FileNode[] = [
            { kind: 'file', name: 'Notes.md', path: 'C:\\ws\\Notes.md' },
            { kind: 'directory', name: 'locked', path: 'C:\\ws\\locked', children: [], unreadable: true },
        ]
        expect(changeAltersTree(tree, 'C:\\ws', { added: ['c:\\WS\\notes.md'], removed: none })).toBe(false)
        expect(changeAltersTree(tree, 'C:\\ws', { added: ['C:\\ws\\locked\\a.md'], removed: none })).toBe(false)
        expect(changeAltersTree(tree, 'C:\\ws', { added: none, removed: ['c:\\ws\\NOTES.md'] })).toBe(true)
    })
})

describe('findNodeByPath', () => {
    it('finds files and directories by path', () => {
        expect(findNodeByPath(sampleTree, '/ws/root.mmd')?.name).toBe('root.mmd')
        expect(findNodeByPath(sampleTree, '/ws/docs')?.kind).toBe('directory')
    })

    it('returns null when path is missing', () => {
        expect(findNodeByPath(sampleTree, '/ws/missing.mmd')).toBeNull()
    })

    it('finds deeply nested files', () => {
        const nested: FileNode[] = [
            {
                kind: 'directory',
                name: 'projects',
                path: '/ws/projects',
                children: [{ kind: 'file', name: 'deep.mmd', path: '/ws/projects/deep.mmd' }],
            },
        ]
        expect(findNodeByPath(nested, '/ws/projects/deep.mmd')?.name).toBe('deep.mmd')
    })
})

describe('childrenOf', () => {
    it('gives the root entries for the workspace root and a folder’s entries for that folder', () => {
        expect(childrenOf(sampleTree, '/ws', '/ws/')).toBe(sampleTree)
        expect(childrenOf(sampleTree, '/ws', '/ws/docs').map((n) => n.name)).toEqual(['readme.md', 'diagram.mmd'])
        expect(childrenOf(sampleTree, '/ws', '/ws/missing')).toEqual([])
    })
})

describe('findNameClash', () => {
    const docs = childrenOf(sampleTree, '/ws', '/ws/docs')

    it('finds a sibling with the same name, ignoring letter case', () => {
        expect(findNameClash(docs, 'README.md')?.path).toBe('/ws/docs/readme.md')
        expect(findNameClash(docs, 'other.md')).toBeNull()
    })

    it('leaves out the entry being renamed, so a case-only rename is allowed', () => {
        expect(findNameClash(docs, 'Readme.md', '/ws/docs/readme.md')).toBeNull()
        expect(findNameClash(docs, 'Diagram.mmd', '/ws/docs/readme.md')?.name).toBe('diagram.mmd')
    })

    it('says whether the clash is a file or a folder', () => {
        expect(nameTakenMessage(sampleTree[0]!)).toBe('A folder named "docs" already exists here.')
        expect(nameTakenMessage(sampleTree[1]!)).toBe('A file named "root.mmd" already exists here.')
    })
})

describe('entryNameError', () => {
    const docs = childrenOf(sampleTree, '/ws', '/ws/docs')

    it('checks the characters, then the file extension, then the siblings', () => {
        expect(entryNameError('my:flow.mmd', 'file', docs)).toBe('Name contains invalid characters')
        expect(entryNameError('notes.txt', 'file', docs)).toBe('File name must end with .md, .mmd or .mermaid.')
        expect(entryNameError('notes.txt', 'directory', docs)).toBeNull()
        expect(entryNameError('flow.mermaid', 'file', docs)).toBeNull()
        expect(entryNameError('Diagram.MMD', 'file', docs)).toBe('A file named "diagram.mmd" already exists here.')
    })

    it('lets a renamed entry keep its own name in another letter case', () => {
        expect(entryNameError('Diagram.mmd', 'file', docs, '/ws/docs/diagram.mmd')).toBeNull()
    })

    it('lets a file Scrivon does not open be renamed to any name, but keeps a document a document', () => {
        expect(entryNameError('logo.png', 'file', docs, '/ws/docs/logo.PNG')).toBeNull()
        expect(entryNameError('logo-dark.png', 'file', docs, '/ws/docs/logo.png')).toBeNull()
        expect(entryNameError('diagram.txt', 'file', docs, '/ws/docs/diagram.mmd')).toBe('File name must end with .md, .mmd or .mermaid.')
    })
})
