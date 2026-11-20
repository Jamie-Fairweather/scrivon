import { titleFromFileName } from '@/lib/default-markdown'
import { errorMessage } from '@/lib/notify'
import {
    getWorkspaceFileSize,
    isFileMissingError,
    joinPath,
    listFolderEntries,
    readEntryKind,
    readWorkspaceFile,
    type FolderEntry,
} from '@/lib/tauri/fs'
import { documentKind, type DocumentKind } from '@/lib/workspace/file-types'

/** Where a folder keeps its own templates, from the top of the folder, as the picker's hint shows it. */
export const TEMPLATES_FOLDER_LABEL = '.scrivon/templates'

/** The templates folder of the open folder `root`. */
export function templatesFolderPath(root: string): string {
    return joinPath(joinPath(root, '.scrivon'), 'templates')
}

/** A template file in the open folder's templates folder. */
export type WorkspaceTemplate = {
    path: string
    fileName: string
    /** Made from the file name, as a new document's heading is (`weekly-review.md` is "Weekly review"). */
    title: string
    kind: DocumentKind
}

export type WorkspaceTemplateList = {
    templates: WorkspaceTemplate[]
    /** False when the open folder has no templates folder, so the picker can say how to add one. */
    folderFound: boolean
}

/** Titles in natural order, letter case ignored: "Step 2" before "step 10". */
const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function compareTemplateTitles(a: WorkspaceTemplate, b: WorkspaceTemplate): number {
    return titleCollator.compare(a.title, b.title) || titleCollator.compare(a.fileName, b.fileName) || (a.fileName < b.fileName ? -1 : 1)
}

/**
 * Whether a document or diagram's name in the templates folder is a file to list: a plain file, or a symlink or
 * junction to one, as the explorer shows it. A link whose target can't be looked up is kept, so picking it says why
 * it can't be read rather than it going missing without a word.
 */
async function isTemplateFile(entry: FolderEntry, path: string): Promise<boolean> {
    if (entry.isFile) return true
    if (entry.isDirectory || !entry.isSymlink) return false
    return (await readEntryKind(path).catch(() => 'file')) === 'file'
}

/**
 * The documents and diagrams directly in the open folder's templates folder (links to them too), sorted by title, from
 * one listing. Folders and other files are left out. A missing templates folder lists none; any other error is thrown.
 */
export async function listWorkspaceTemplates(root: string): Promise<WorkspaceTemplateList> {
    const folder = templatesFolderPath(root)
    let entries
    try {
        entries = await listFolderEntries(folder)
    } catch (err) {
        if (isFileMissingError(err)) return { templates: [], folderFound: false }
        throw err
    }
    const found = await Promise.all(
        entries.map(async (entry): Promise<WorkspaceTemplate | null> => {
            const kind = documentKind(entry.name)
            const path = joinPath(folder, entry.name)
            if (!kind || !(await isTemplateFile(entry, path))) return null
            return { path, fileName: entry.name, title: titleFromFileName(entry.name) || entry.name, kind }
        })
    )
    const templates = found.filter((template): template is WorkspaceTemplate => template !== null)
    return { templates: templates.sort(compareTemplateTitles), folderFound: true }
}

/** Templates bigger than this aren't read: a template is a page or two, and a huge file would only slow the app down. */
export const MAX_TEMPLATE_BYTES = 1024 * 1024

/** Thrown when a template can't be used, with a sentence for the picker to show. */
export class TemplateReadError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'TemplateReadError'
    }
}

/**
 * The text of a template in the open folder: `unsaved`, the text of its tab, when it is open with edits that aren't
 * saved, else the file on disk. Throws TemplateReadError when the file is over MAX_TEMPLATE_BYTES or can't be read.
 */
export async function readWorkspaceTemplate(template: WorkspaceTemplate, unsaved?: string): Promise<string> {
    if (unsaved !== undefined) return unsaved
    const size = await getWorkspaceFileSize(template.path)
    if (size !== null && size > MAX_TEMPLATE_BYTES) {
        throw new TemplateReadError(`"${template.fileName}" is over 1 MB, which is too big for a template.`)
    }
    try {
        return await readWorkspaceFile(template.path)
    } catch (err) {
        const reason = isFileMissingError(err) ? 'It was moved or deleted.' : errorMessage(err, '')
        throw new TemplateReadError(`Couldn't read "${template.fileName}".${reason ? ` ${reason}` : ''}`)
    }
}
