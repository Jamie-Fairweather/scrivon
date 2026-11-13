import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { APP_EXAMPLE_BY_ID } from '@/lib/examples/app-samples'
import { notifyError } from '@/lib/notify'
import { listFolderNames } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'
import { useSaveExampleCopy } from './use-save-example-copy'

const ROOT = 'C:\\ws'
const session = vi.hoisted(() => ({
    workspaceRoot: 'C:\\ws' as string | null,
    tree: [] as FileNode[],
    createFile: vi.fn<(parentPath: string, name: string, content?: string) => Promise<void>>(async () => undefined),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
}))
vi.mock('@/components/studio/editor/editor-focus', () => ({ focusEditorFor: vi.fn() }))
vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(() => 'toast'),
}))
vi.mock('@/lib/tauri/fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/fs')>()),
    listFolderNames: vi.fn(async () => []),
}))

const SIMPLE_FLOW = APP_EXAMPLE_BY_ID['sample-1']!

function file(name: string): FileNode {
    return { kind: 'file', name, path: `${ROOT}\\${name}` }
}

async function save(exampleId: string) {
    const { result } = renderHook(useSaveExampleCopy)
    await result.current(exampleId)
}

beforeEach(() => {
    vi.clearAllMocks()
    session.workspaceRoot = ROOT
    session.tree = []
})

describe('useSaveExampleCopy', () => {
    it('saves the example into the open folder under its own name, and opens it in the editor', async () => {
        await save('sample-1')

        expect(session.createFile).toHaveBeenCalledWith(ROOT, 'Simple Flow.mmd', SIMPLE_FLOW.source)
        expect(focusEditorFor).toHaveBeenCalledWith(`${ROOT}\\Simple Flow.mmd`)
    })

    it('picks a name nothing in the folder uses, on disk or in the file list, ignoring letter case', async () => {
        vi.mocked(listFolderNames).mockResolvedValue(['simple flow.mmd', 'notes.md'])
        session.tree = [file('Simple Flow 2.mmd')]

        await save('sample-1')

        expect(session.createFile).toHaveBeenCalledWith(ROOT, 'Simple Flow 3.mmd', SIMPLE_FLOW.source)
    })

    it('says why when the folder could not be read, and writes nothing', async () => {
        vi.mocked(listFolderNames).mockRejectedValue(new Error('Access is denied. (os error 5)'))

        await save('sample-1')

        expect(notifyError).toHaveBeenCalledWith("Couldn't save a copy of Simple Flow", expect.any(Error))
        expect(session.createFile).not.toHaveBeenCalled()
    })

    it('does nothing with no folder open, or for an example that does not exist', async () => {
        await save('no-such-example')
        session.workspaceRoot = null
        await save('sample-1')

        expect(session.createFile).not.toHaveBeenCalled()
        expect(notifyError).not.toHaveBeenCalled()
    })
})
