import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderEntry } from '@/lib/tauri/fs'
import {
    listWorkspaceTemplates,
    MAX_TEMPLATE_BYTES,
    readWorkspaceTemplate,
    TemplateReadError,
    templatesFolderPath,
    type WorkspaceTemplate,
} from '@/lib/templates/workspace-templates'

const { fsMock } = vi.hoisted(() => ({
    fsMock: {
        listFolderEntries: vi.fn<(path: string) => Promise<FolderEntry[]>>(),
        getWorkspaceFileSize: vi.fn<(path: string) => Promise<number | null>>(),
        readWorkspaceFile: vi.fn<(path: string) => Promise<string>>(),
    },
}))

vi.mock('@/lib/tauri/fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tauri/fs')>()), ...fsMock }))

const file = (name: string): FolderEntry => ({ name, isFile: true, isDirectory: false })
const folder = (name: string): FolderEntry => ({ name, isFile: false, isDirectory: true })

describe('listWorkspaceTemplates', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('looks in .scrivon/templates at the top of the open folder, with one listing', async () => {
        fsMock.listFolderEntries.mockResolvedValue([])
        await listWorkspaceTemplates('C:\\work')
        expect(templatesFolderPath('C:\\work')).toBe('C:\\work\\.scrivon\\templates')
        expect(fsMock.listFolderEntries).toHaveBeenCalledExactlyOnceWith('C:\\work\\.scrivon\\templates')
    })

    it('lists none, and says the folder is missing, when there is no templates folder', async () => {
        fsMock.listFolderEntries.mockRejectedValue('The system cannot find the path specified. (os error 3)')
        await expect(listWorkspaceTemplates('/ws')).resolves.toEqual({ templates: [], folderFound: false })
    })

    it('passes on any other error', async () => {
        fsMock.listFolderEntries.mockRejectedValue('Access is denied. (os error 5)')
        await expect(listWorkspaceTemplates('/ws')).rejects.toBe('Access is denied. (os error 5)')
    })

    it('lists only the documents and diagrams directly in it, titled from their names', async () => {
        fsMock.listFolderEntries.mockResolvedValue([
            file('weekly-review.md'),
            folder('archive'),
            folder('old.md'),
            file('notes.txt'),
            file('logo.png'),
            file('Release_Flow.mmd'),
            file('Big Plan.MARKDOWN'),
            file('sequence.mermaid'),
            { name: 'link.md', isFile: false, isDirectory: false },
        ])

        const { templates, folderFound } = await listWorkspaceTemplates('/ws')

        expect(folderFound).toBe(true)
        expect(templates).toEqual<WorkspaceTemplate[]>([
            { path: '/ws/.scrivon/templates/Big Plan.MARKDOWN', fileName: 'Big Plan.MARKDOWN', title: 'Big Plan', kind: 'markdown' },
            { path: '/ws/.scrivon/templates/Release_Flow.mmd', fileName: 'Release_Flow.mmd', title: 'Release Flow', kind: 'mermaid' },
            { path: '/ws/.scrivon/templates/sequence.mermaid', fileName: 'sequence.mermaid', title: 'Sequence', kind: 'mermaid' },
            { path: '/ws/.scrivon/templates/weekly-review.md', fileName: 'weekly-review.md', title: 'Weekly review', kind: 'markdown' },
        ])
    })

    it('sorts by title ignoring letter case, with numbers in natural order', async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('step 10.md'), file('Step 2.md'), file('beta.mmd'), file('Alpha.md'), file('step 1.md')])

        const { templates } = await listWorkspaceTemplates('/ws')

        expect(templates.map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Step 1', 'Step 2', 'Step 10'])
    })

    it('is empty for an empty templates folder', async () => {
        fsMock.listFolderEntries.mockResolvedValue([])
        await expect(listWorkspaceTemplates('/ws')).resolves.toEqual({ templates: [], folderFound: true })
    })
})

describe('readWorkspaceTemplate', () => {
    const template: WorkspaceTemplate = { path: '/ws/.scrivon/templates/weekly.md', fileName: 'weekly.md', title: 'Weekly', kind: 'markdown' }

    beforeEach(() => {
        vi.clearAllMocks()
        fsMock.getWorkspaceFileSize.mockResolvedValue(120)
        fsMock.readWorkspaceFile.mockResolvedValue('# {{title}}\n')
    })

    it('checks the size, then reads the file', async () => {
        await expect(readWorkspaceTemplate(template)).resolves.toBe('# {{title}}\n')
        expect(fsMock.getWorkspaceFileSize).toHaveBeenCalledWith(template.path)
        expect(fsMock.readWorkspaceFile).toHaveBeenCalledWith(template.path)
    })

    it('reads a file of exactly 1 MB, but not one over it', async () => {
        fsMock.getWorkspaceFileSize.mockResolvedValueOnce(MAX_TEMPLATE_BYTES)
        await expect(readWorkspaceTemplate(template)).resolves.toBe('# {{title}}\n')

        fsMock.getWorkspaceFileSize.mockResolvedValueOnce(MAX_TEMPLATE_BYTES + 1)
        const tooBig = readWorkspaceTemplate(template)
        await expect(tooBig).rejects.toBeInstanceOf(TemplateReadError)
        await expect(tooBig).rejects.toThrow('"weekly.md" is over 1 MB, which is too big for a template.')
        expect(fsMock.readWorkspaceFile).toHaveBeenCalledTimes(1)
    })

    it("says why a file can't be read", async () => {
        fsMock.readWorkspaceFile.mockRejectedValueOnce(
            'The process cannot access the file because it is being used by another process. (os error 32)'
        )
        await expect(readWorkspaceTemplate(template)).rejects.toThrow(
            'Couldn\'t read "weekly.md". The process cannot access the file because it is being used by another process. (os error 32)'
        )

        fsMock.getWorkspaceFileSize.mockResolvedValueOnce(null)
        fsMock.readWorkspaceFile.mockRejectedValueOnce('The system cannot find the file specified. (os error 2)')
        await expect(readWorkspaceTemplate(template)).rejects.toThrow('Couldn\'t read "weekly.md". It was moved or deleted.')
    })

    it("uses the text of the template's tab when it has unsaved edits, without reading the file", async () => {
        await expect(readWorkspaceTemplate(template, '# Edited {{title}}\n')).resolves.toBe('# Edited {{title}}\n')
        await expect(readWorkspaceTemplate(template, '')).resolves.toBe('')
        expect(fsMock.getWorkspaceFileSize).not.toHaveBeenCalled()
        expect(fsMock.readWorkspaceFile).not.toHaveBeenCalled()
    })
})
