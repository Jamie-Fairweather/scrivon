'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { useDeleteConfirm } from '@/components/studio/dialogs/delete-confirm-provider'
import { useMoveTo } from '@/components/studio/dialogs/move-to-provider'
import { useNamePrompt, type NamePromptKind, type NamePromptSubject } from '@/components/studio/dialogs/name-prompt-provider'
import { useTemplatePicker } from '@/components/studio/dialogs/template-picker-provider'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { titleFromFileName } from '@/lib/default-markdown'
import { getParentPath, joinPath } from '@/lib/tauri/fs'
import { fillTemplate } from '@/lib/templates/fill-template'
import { documentExtension, documentKind, fileExtension, withDocumentExtension, type DocumentKind } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

/** The plain new items. A new file from a template has its own prompt kind, as it comes after the template picker. */
export type NewItemKind = Exclude<NamePromptKind, 'rename' | 'new-from-template'>

/** The name a new file starts with, and the extension a name typed without one gets. */
const NEW_FILE = {
    'new-diagram': { name: 'diagram.mmd', extension: '.mmd' },
    'new-document': { name: 'document.md', extension: '.md' },
} as const

/** What a new file's name prompt says the file is for, when that is more than its kind. The prompt adds the folder. */
export type NewFileSubject = Omit<Extract<NamePromptSubject, { kind: 'new-from-template' }>, 'folder'>

/** How a new diagram or document starts, when that isn't the usual way. Ignored for a new folder. */
export type NewFileOptions = {
    /**
     * The name the prompt starts from, made free in the folder (`plan.md`, then `plan 2.md`). Its extension is the one
     * a name typed without one gets. Left out, the kind's own: `diagram.mmd` or `document.md`.
     */
    name?: string
    /** What the prompt says the file is for. Left out, the kind's own words. */
    subject?: NewFileSubject
    /**
     * The new file's text, or how to make it from the name the file gets. Left out, the usual starting text for the
     * kind of file. Given, the name has to be for the same kind of file as the starting name (a diagram's text can't go
     * in a `.md` file).
     */
    content?: string | ((fileName: string) => string)
}

/** Why `fileName` can't hold text written for `kind`, or null when it can. */
function kindMismatchError(fileName: string, kind: DocumentKind, subject: NewFileSubject | undefined): string | null {
    const named = documentKind(fileName)
    if (!named || named === kind) return null
    const [what, extensions] = kind === 'mermaid' ? ['diagram', '.mmd or .mermaid'] : ['document', '.md or .markdown']
    return subject?.kind === 'new-from-template'
        ? `This template makes a ${what}, so the name must end with ${extensions}.`
        : `This file is a ${what}, so the name must end with ${extensions}.`
}

/**
 * Asks for a name, then makes a new diagram, document or folder in the folder given. A new file opens in a tab,
 * and the editor takes the keyboard so the user can start typing. Resolves to false when the prompt was cancelled.
 * `options` start a file from a given name and text, such as a template's (see NewFileOptions).
 */
export function useCreateNewItem(): (kind: NewItemKind, folder: string, options?: NewFileOptions) => Promise<boolean> {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName, getNameError } = useWorkspaceSession()

    return useCallback(
        async (kind: NewItemKind, folder: string, options: NewFileOptions = {}) => {
            if (kind === 'new-folder') {
                const name = await promptName({
                    kind,
                    folder,
                    defaultValue: suggestName(folder, 'diagrams'),
                    validate: (value) => getNameError(folder, value, 'directory'),
                })
                if (!name) return false
                await createFolder(folder, name)
                return true
            }
            const startName = options.name ?? NEW_FILE[kind].name
            const extension = documentExtension(startName) ?? NEW_FILE[kind].extension
            const { content, subject } = options
            // Text written for one kind of file has to go in that kind of file.
            const contentKind = content === undefined ? null : documentKind(extension)
            // A name typed without an extension gets the starting name's.
            const finalName = (value: string) => withDocumentExtension(value, extension)
            const name = await promptName({
                ...(subject ?? { kind }),
                folder,
                defaultValue: suggestName(folder, startName),
                validate: (value) => {
                    const fileName = finalName(value)
                    return (contentKind && kindMismatchError(fileName, contentKind, subject)) || getNameError(folder, fileName, 'file')
                },
            })
            if (!name) return false
            const fileName = finalName(name)
            if (content === undefined) await createFile(folder, fileName)
            else await createFile(folder, fileName, typeof content === 'function' ? content(fileName) : content)
            // If the file couldn't be made, its tab never shows and focus stays where it is.
            focusEditorFor(joinPath(folder, fileName))
            return true
        },
        [promptName, createFile, createFolder, suggestName, getNameError]
    )
}

/**
 * Asks which template to start from, then for a name, then makes the file from the template in the folder given, with
 * its placeholders filled in, and opens it. Resolves to false when the picker or the prompt was cancelled.
 */
export function useCreateFromTemplate(): (folder: string) => Promise<boolean> {
    const { chooseTemplate } = useTemplatePicker()
    const createNewItem = useCreateNewItem()

    return useCallback(
        async (folder: string) => {
            const template = await chooseTemplate()
            if (!template) return false
            const { title, fileName, kind, text } = template
            const extension = documentExtension(fileName) ?? (kind === 'mermaid' ? '.mmd' : '.md')
            return createNewItem(kind === 'mermaid' ? 'new-diagram' : 'new-document', folder, {
                name: fileName,
                subject: { kind: 'new-from-template', template: { title, extension } },
                // The date and time are when the file is made, not when the picker opened.
                content: (name) => fillTemplate(text, { title: titleFromFileName(name), now: new Date(), kind }),
            })
        },
        [chooseTemplate, createNewItem]
    )
}

/** New items in one folder, for that folder's menus. Does nothing while `parentPath` is null. */
export function useFileTreeActions(parentPath: string | null) {
    const createNewItem = useCreateNewItem()
    const createFromTemplate = useCreateFromTemplate()

    return useMemo(() => {
        const inParent = (kind: NewItemKind) => async () => {
            if (parentPath) await createNewItem(kind, parentPath)
        }
        return {
            createMermaidFileInParent: inParent('new-diagram'),
            createMarkdownFileInParent: inParent('new-document'),
            createFolderInParent: inParent('new-folder'),
            createFromTemplateInParent: async () => {
                if (parentPath) await createFromTemplate(parentPath)
            },
        }
    }, [parentPath, createNewItem, createFromTemplate])
}

export type FileTreeEntryActions = {
    /** Resolves to the path the entry should have now (the new one once renamed), or null when cancelled. */
    renameWithPrompt: (node: FileNode) => Promise<string | null>
    /** Resolves to whether the user confirmed the delete (true even when it then failed or was stopped). */
    deleteWithConfirm: (node: FileNode) => Promise<boolean>
    /** Asks which folder to move the entry to, and moves it. Resolves to where it is now, or null when it didn't move. */
    moveWithPicker: (node: FileNode) => Promise<string | null>
}

/** Rename, move and delete for a file or folder in the tree, shared by its menus and the F2 and Delete keys. */
export function useFileTreeEntryActions(): FileTreeEntryActions {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { chooseFolder } = useMoveTo()
    const { renameEntry, moveEntry, deleteEntry, getNameError } = useWorkspaceSession()

    const renameWithPrompt = useCallback(
        async (node: FileNode): Promise<string | null> => {
            const folder = getParentPath(node.path)
            // A file renamed without an extension keeps its current one ('notes.md' -> 'meeting' -> 'meeting.md',
            // 'screenshot.png' -> 'beach' -> 'beach.png'), and the prompt leaves it unselected. A folder has none.
            const docExtension = node.kind === 'file' ? documentExtension(node.name) : null
            const extension = node.kind === 'file' ? (docExtension ?? fileExtension(node.name)) : null
            const finalName = (value: string): string => {
                if (!extension || !value) return value
                // A document has to stay one; 'todo.txt' is kept as typed, for the check to refuse.
                if (docExtension) return withDocumentExtension(value, docExtension)
                // Any other file keeps whatever extension was typed ('backup.7z', 'plan v1.2'), found the same way as
                // its own, so that isn't added twice. A dot at the end leaves it off, as in File Explorer.
                if (value.endsWith('.')) return value.slice(0, -1)
                return fileExtension(value) ? value : `${value}${extension}`
            }
            const name = await promptName({
                kind: 'rename',
                entry: node,
                defaultValue: node.name,
                extension,
                validate: (value) => getNameError(folder, finalName(value), node.kind, node.path),
                // Says what the entry will be called when that isn't what was typed, and how to leave the extension off.
                note: (value) => {
                    const final = finalName(value)
                    if (final === value) return null
                    const named = `Will be named "${final}".`
                    return docExtension || value.endsWith('.') ? named : `${named} To leave off "${extension}", end the name with a dot.`
                },
            })
            if (!name) return null
            const newName = finalName(name)
            if (newName === node.name) return node.path
            await renameEntry(node.path, newName, node.kind === 'directory')
            return joinPath(folder, newName)
        },
        [promptName, getNameError, renameEntry]
    )

    const deleteWithConfirm = useCallback(
        async (node: FileNode) => {
            const ok = await confirmDelete(node)
            if (ok) await deleteEntry(node.path, node.kind === 'directory')
            return ok
        },
        [confirmDelete, deleteEntry]
    )

    const moveWithPicker = useCallback(
        async (node: FileNode) => {
            const folder = await chooseFolder(node)
            return folder ? moveEntry(node.path, node.kind === 'directory', folder) : null
        },
        [chooseFolder, moveEntry]
    )

    return { renameWithPrompt, deleteWithConfirm, moveWithPicker }
}

const TreeEntryActionsContext = createContext<FileTreeEntryActions | null>(null)

/** FileTree gives its row menus the rename and delete its keys use, which also put focus back on a row afterwards. */
export const TreeEntryActionsProvider = TreeEntryActionsContext.Provider

/** Rename and delete for a row's menu: the tree's own inside a FileTree, else the plain ones. */
export function useRowEntryActions(): FileTreeEntryActions {
    const plain = useFileTreeEntryActions()
    return useContext(TreeEntryActionsContext) ?? plain
}
