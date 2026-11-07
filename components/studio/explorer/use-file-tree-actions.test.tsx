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

    it('leaves folder names as typed, and has the prompt select the whole name', async () => {
        promptName.mockResolvedValueOnce('archive')
        const { result } = renderHook(() => useFileTreeEntryActions())
        const node: FileNode = { kind: 'directory', name: 'notes.md', path: '/ws/notes.md', children: [] }

        await expect(result.current.renameWithPrompt(node)).resolves.toBe('/ws/archive')
        expect(promptName.mock.calls[0]![0].extension).toBeNull()
        expect(session.renameEntry).toHaveBeenCalledWith('/ws/notes.md', 'archive', true)
    })
})
