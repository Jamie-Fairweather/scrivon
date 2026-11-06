import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NamePromptOptions } from '@/components/studio/dialogs/name-prompt-provider'
import { useFileTreeActions } from './use-file-tree-actions'

const { promptName, session } = vi.hoisted(() => ({
    promptName: vi.fn<(options: NamePromptOptions) => Promise<string | null>>(),
    session: {
        createFile: vi.fn(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        suggestName: vi.fn((_parent: string, name: string) => name),
        getNameError: vi.fn<(parent: string, name: string, kind: string) => string | null>(() => null),
    },
}))

vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => session }))

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
        expect(options).toMatchObject({ defaultValue: 'diagram.mmd', placeholder: 'diagram.mmd' })
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

        expect(session.createFolder).toHaveBeenCalledWith('/ws', 'drafts')
    })
})
