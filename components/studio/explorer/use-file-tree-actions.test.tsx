import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NamePromptOptions } from '@/components/studio/dialogs/name-prompt-provider'
import type { FileNode } from '@/lib/workspace/types'
import { useFileTreeActions, useFileTreeEntryActions } from './use-file-tree-actions'

const { promptName, session } = vi.hoisted(() => ({
    promptName: vi.fn<(options: NamePromptOptions) => Promise<string | null>>(),
    session: {
        createFile: vi.fn(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        renameEntry: vi.fn(async () => undefined),
        deleteEntry: vi.fn(async () => undefined),
        suggestName: vi.fn((_parent: string, name: string) => name),
        getNameError: vi.fn<(parent: string, name: string, kind: string) => string | null>(() => null),
    },
}))

vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => session }))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete: vi.fn() }) }))

describe('useFileTreeActions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('adds .mmd to a new diagram name typed without an extension, and checks that name', async () => {
        promptName.mockResolvedValueOnce('login flow')
        const { result } = renderHook(() => useFileTreeActions('/ws'))

        await act(async () => {
            await result.current.createMermaidFileInParent()
        })

        const options = promptName.mock.calls[0]![0]
        expect(options).toMatchObject({ defaultValue: 'diagram.mmd', placeholder: 'diagram.mmd', description: 'Creates the diagram in "ws".' })
        options.validate!('login flow')
        expect(session.getNameError).toHaveBeenLastCalledWith('/ws', 'login flow.mmd', 'file')
        expect(session.createFile).toHaveBeenCalledWith('/ws', 'login flow.mmd')
    })

    it('adds .md to a new document name, but keeps an extension the user typed', async () => {
        promptName.mockResolvedValueOnce('meeting').mockResolvedValueOnce('flow.mermaid')
        const { result } = renderHook(() => useFileTreeActions('/ws'))

        await act(async () => {
            await result.current.createMarkdownFileInParent()
        })
        await act(async () => {
            await result.current.createMarkdownFileInParent()
        })

        expect(session.createFile).toHaveBeenNthCalledWith(1, '/ws', 'meeting.md')
        expect(session.createFile).toHaveBeenNthCalledWith(2, '/ws', 'flow.mermaid')
    })

    it('leaves folder names as typed', async () => {
        promptName.mockResolvedValueOnce('drafts')
        const { result } = renderHook(() => useFileTreeActions('/ws'))

        await act(async () => {
            await result.current.createFolderInParent()
        })

        expect(promptName.mock.calls[0]![0]).toMatchObject({ description: 'Creates the folder in "ws".', placeholder: 'Folder name' })
        expect(session.createFolder).toHaveBeenCalledWith('/ws', 'drafts')
    })
})

describe('useFileTreeEntryActions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('resolves a rename to the path the entry has afterwards, or null when cancelled', async () => {
        promptName.mockResolvedValueOnce('meeting').mockResolvedValueOnce('notes.md').mockResolvedValueOnce(null)
        const { result } = renderHook(() => useFileTreeEntryActions())
        const node = { kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' } as const

        // Typed without an extension: the file keeps its own.
        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/docs/meeting.md')
        expect(session.renameEntry).toHaveBeenCalledWith('/ws/docs/notes.md', 'meeting.md', false)
        // Same name: nothing to do, and the entry keeps its path.
        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/docs/notes.md')
        await expect(result.current.renameWithPrompt(node)).resolves.toBeNull()
        expect(session.renameEntry).toHaveBeenCalledTimes(1)
    })

    it("keeps the extension of a file Scrivon doesn't open when it is renamed without one", async () => {
        promptName.mockResolvedValueOnce('beach').mockResolvedValueOnce('beach.jpg')
        const { result } = renderHook(() => useFileTreeEntryActions())
        const node = { kind: 'file', name: 'screenshot.png', path: '/ws/screenshot.png' } as const

        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/beach.png')
        const options = promptName.mock.calls[0]![0]
        expect(options.extension).toBe('.png')
        options.validate!('beach')
        expect(session.getNameError).toHaveBeenLastCalledWith('/ws', 'beach.png', 'file', '/ws/screenshot.png')
        expect(session.renameEntry).toHaveBeenCalledWith('/ws/screenshot.png', 'beach.png', false)
        // An extension the user typed is kept as typed.
        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/beach.jpg')
        expect(session.renameEntry).toHaveBeenLastCalledWith('/ws/screenshot.png', 'beach.jpg', false)
    })

    it("doesn't add the extension of a file Scrivon doesn't open a second time, whatever it looks like", async () => {
        const { result } = renderHook(() => useFileTreeEntryActions())
        const rename = (name: string, typed: string) => {
            promptName.mockResolvedValueOnce(typed)
            return result.current.renameWithPrompt({ kind: 'file', name, path: `/ws/${name}` })
        }

        // F2 then Enter changes nothing.
        await expect(rename('backup.7z', 'backup.7z')).resolves.toBe('/ws/backup.7z')
        await expect(rename('plan v1.2', 'plan v1.2')).resolves.toBe('/ws/plan v1.2')
        await expect(rename('scrivon.code-workspace', 'scrivon.code-workspace')).resolves.toBe('/ws/scrivon.code-workspace')
        expect(session.renameEntry).not.toHaveBeenCalled()

        await expect(rename('backup.7z', 'old.7z')).resolves.toBe('/ws/old.7z')
        expect(session.renameEntry).toHaveBeenLastCalledWith('/ws/backup.7z', 'old.7z', false)
        await expect(rename('Notes 2026.11.07', 'Notes 2026.11.08')).resolves.toBe('/ws/Notes 2026.11.08')
        await expect(rename('screenshot.png', 'photo.7z')).resolves.toBe('/ws/photo.7z')
        // Typed without one, it still gets its own.
        await expect(rename('site.webmanifest', 'app')).resolves.toBe('/ws/app.webmanifest')
    })

    it("leaves off the extension of a file Scrivon doesn't open when the name ends with a dot, and says so", async () => {
        promptName.mockResolvedValueOnce('Makefile.')
        const { result } = renderHook(() => useFileTreeEntryActions())
        const node = { kind: 'file', name: 'Makefile.txt', path: '/ws/Makefile.txt' } as const

        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/Makefile')
        expect(session.renameEntry).toHaveBeenCalledWith('/ws/Makefile.txt', 'Makefile', false)
        const options = promptName.mock.calls[0]![0]
        options.validate!('Makefile.')
        expect(session.getNameError).toHaveBeenLastCalledWith('/ws', 'Makefile', 'file', '/ws/Makefile.txt')
        // The field says what the file will be called whenever that isn't what was typed.
        expect(options.note!('Makefile')).toBe('Will be named "Makefile.txt". To leave off ".txt", end the name with a dot.')
        expect(options.note!('Makefile.')).toBe('Will be named "Makefile".')
        expect(options.note!('Makefile.txt')).toBeNull()
    })

    it('says when a document renamed without an extension keeps its own', async () => {
        promptName.mockResolvedValueOnce(null)
        const { result } = renderHook(() => useFileTreeEntryActions())

        await result.current.renameWithPrompt({ kind: 'file', name: 'notes.md', path: '/ws/notes.md' })

        const { note } = promptName.mock.calls[0]![0]
        expect(note!('meeting')).toBe('Will be named "meeting.md".')
        expect(note!('meeting.md')).toBeNull()
    })

    it('leaves folder names as typed, and has the prompt select the whole name', async () => {
        promptName.mockResolvedValueOnce('archive')
        const { result } = renderHook(() => useFileTreeEntryActions())
        const node: FileNode = { kind: 'directory', name: 'notes.md', path: '/ws/notes.md', children: [] }

        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/archive')
        const options = promptName.mock.calls[0]![0]
        expect(options.extension).toBeNull()
        expect(options.note!('archive')).toBeNull()
        expect(session.renameEntry).toHaveBeenCalledWith('/ws/notes.md', 'archive', true)
    })
})
