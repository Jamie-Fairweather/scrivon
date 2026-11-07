import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useFileTreeActions } from './use-file-tree-actions'

const { promptName, session } = vi.hoisted(() => ({
    promptName: vi.fn<() => Promise<string | null>>(),
    session: {
        createFile: vi.fn<(parent: string, name: string) => Promise<void>>(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        suggestName: (_parent: string, name: string) => name,
        getNameError: () => null,
    },
}))

vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => session }))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete: vi.fn() }) }))
vi.mock('@/components/studio/editor/editor-focus', () => ({ focusEditorFor: vi.fn() }))

describe('useFileTreeActions focus', () => {
    beforeEach(() => vi.clearAllMocks())

    it('puts the keyboard in the editor on the new file once it has been made', async () => {
        let finish = () => {}
        session.createFile.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
        promptName.mockResolvedValueOnce('login flow')
        const { result } = renderHook(() => useFileTreeActions('C:\\ws'))

        let done: Promise<void> = Promise.resolve()
        await act(async () => {
            done = result.current.createMermaidFileInParent()
        })
        expect(focusEditorFor).not.toHaveBeenCalled()

        await act(async () => {
            finish()
            await done
        })
        expect(focusEditorFor).toHaveBeenCalledWith('C:\\ws\\login flow.mmd')
    })

    it('does the same for a new document, but not for a new folder', async () => {
        promptName.mockResolvedValueOnce('notes').mockResolvedValueOnce('drafts')
        const { result } = renderHook(() => useFileTreeActions('/ws'))

        await act(async () => {
            await result.current.createMarkdownFileInParent()
        })
        await act(async () => {
            await result.current.createFolderInParent()
        })

        expect(focusEditorFor).toHaveBeenCalledTimes(1)
        expect(focusEditorFor).toHaveBeenCalledWith('/ws/notes.md')
    })

    it('leaves focus alone when the name prompt is cancelled', async () => {
        promptName.mockResolvedValueOnce(null)
        const { result } = renderHook(() => useFileTreeActions('/ws'))

        await act(async () => {
            await result.current.createMermaidFileInParent()
        })

        expect(focusEditorFor).not.toHaveBeenCalled()
    })
})
