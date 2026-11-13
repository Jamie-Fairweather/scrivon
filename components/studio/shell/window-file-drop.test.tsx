import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'

type DropListener = (event: { payload: { type: 'drop'; paths: string[]; position: { x: number; y: number } } }) => void
const webview = vi.hoisted(() => ({ listener: null as DropListener | null, unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: () => ({
        onDragDropEvent: async (listener: DropListener) => {
            webview.listener = listener
            return webview.unlisten
        },
    }),
}))

const notify = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyInfo: notify.info, notifyError: notify.error }))

const session = vi.hoisted(() => ({
    workspaceRoot: 'C:\\notes' as string | null,
    openFile: vi.fn<(path: string) => Promise<void>>(async () => {}),
    pickAndOpenWorkspace: vi.fn(async () => {}),
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => session }))

const { WindowFileDrop } = await import('./window-file-drop')

/** Files dropped from File Explorer somewhere in the window that no drop target takes. */
async function drop(paths: string[]) {
    await vi.waitFor(() => expect(webview.listener).not.toBeNull())
    webview.listener!({ payload: { type: 'drop', paths, position: { x: 10, y: 10 } } })
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(true)
    webview.listener = null
    session.workspaceRoot = 'C:\\notes'
    document.elementFromPoint = vi.fn(() => document.body)
})

describe('WindowFileDrop', () => {
    it('opens the Markdown and diagram files dropped from the open folder, in order', async () => {
        render(<WindowFileDrop />)

        await drop(['C:\\notes\\a.md', 'C:\\Notes\\flows\\b.mmd', 'C:\\notes\\c.mermaid'])

        await vi.waitFor(() => expect(session.openFile).toHaveBeenCalledTimes(3))
        expect(session.openFile.mock.calls.map(([path]) => path)).toEqual(['C:\\notes\\a.md', 'C:\\Notes\\flows\\b.mmd', 'C:\\notes\\c.mermaid'])
        expect(notify.info).not.toHaveBeenCalled()
    })

    it('doesn’t open a file from outside the open folder, and offers to open a folder', async () => {
        render(<WindowFileDrop />)

        await drop(['D:\\elsewhere\\readme.md', 'C:\\notes-old\\b.md'])

        await vi.waitFor(() => expect(notify.info).toHaveBeenCalledTimes(1))
        expect(notify.info).toHaveBeenCalledWith("2 files aren't in the open folder", {
            description: 'Scrivon edits files inside the folder you open. Open their folder, then drop them again.',
            action: { label: 'Open Folder…', onClick: expect.any(Function) },
        })
        expect(session.openFile).not.toHaveBeenCalled()
        notify.info.mock.calls[0]![1].action.onClick()
        expect(session.pickAndOpenWorkspace).toHaveBeenCalled()
    })

    it('says to open a folder first when none is open', async () => {
        session.workspaceRoot = null
        render(<WindowFileDrop />)

        await drop(['D:\\elsewhere\\readme.md'])

        await vi.waitFor(() =>
            expect(notify.info).toHaveBeenCalledWith('Open a folder to edit readme.md', {
                description: 'Scrivon edits files inside the folder you open. Open its folder, then drop it again.',
                action: { label: 'Open Folder…', onClick: expect.any(Function) },
            })
        )
        expect(session.openFile).not.toHaveBeenCalled()
    })

    it('says where images go when nothing under them took them', async () => {
        render(<WindowFileDrop />)

        await drop(['D:\\Pictures\\cat.png'])
        await drop(['D:\\Pictures\\a.png', 'D:\\Pictures\\b.jpg'])

        const description = 'Images go into a Markdown file from the open folder. Drop them onto its text in the editor.'
        await vi.waitFor(() => expect(notify.info).toHaveBeenCalledTimes(2))
        expect(notify.info).toHaveBeenCalledWith("Can't add cat.png here", { description })
        expect(notify.info).toHaveBeenCalledWith("Can't add 2 images here", { description })
    })

    it('says which files it opens when given another kind', async () => {
        render(<WindowFileDrop />)

        await drop(['C:\\notes\\report.pdf', 'C:\\notes\\a.md'])

        await vi.waitFor(() =>
            expect(notify.info).toHaveBeenCalledWith("Can't open report.pdf", { description: 'Scrivon opens .md, .mmd and .mermaid files.' })
        )
        expect(session.openFile).toHaveBeenCalledWith('C:\\notes\\a.md')
    })

    it('uses the folder open at the time of the drop', async () => {
        const view = render(<WindowFileDrop />)
        session.workspaceRoot = 'D:\\elsewhere'
        view.rerender(<WindowFileDrop />)

        await drop(['D:\\elsewhere\\readme.md'])

        await vi.waitFor(() => expect(session.openFile).toHaveBeenCalledWith('D:\\elsewhere\\readme.md'))
    })

    it('says when a file couldn’t be opened', async () => {
        const err = new Error('Access is denied.')
        session.openFile.mockRejectedValueOnce(err)
        render(<WindowFileDrop />)

        await drop(['C:\\notes\\a.md'])

        await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith("Couldn't open the dropped file", err))
    })

    it('stops listening when it goes', async () => {
        const view = render(<WindowFileDrop />)
        await vi.waitFor(() => expect(webview.listener).not.toBeNull())

        view.unmount()

        await vi.waitFor(() => expect(webview.unlisten).toHaveBeenCalled())
    })
})
