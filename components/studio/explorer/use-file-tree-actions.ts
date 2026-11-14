'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { useDeleteConfirm } from '@/components/studio/dialogs/delete-confirm-provider'
import { useNamePrompt, type NamePromptKind } from '@/components/studio/dialogs/name-prompt-provider'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { getParentPath, joinPath } from '@/lib/tauri/fs'
import { documentExtension, fileExtension, withDocumentExtension } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

export type NewItemKind = Exclude<NamePromptKind, 'rename'>

/** The name a new file starts with, and the extension a name typed without one gets. */
const NEW_FILE = {
    'new-diagram': { name: 'diagram.mmd', extension: '.mmd' },
    'new-document': { name: 'document.md', extension: '.md' },
} as const

/**
 * Asks for a name, then makes a new diagram, document or folder in the folder given. A new file opens in a tab,
 * and the editor takes the keyboard so the user can start typing. Resolves to false when the prompt was cancelled.
 */
export function useCreateNewItem(): (kind: NewItemKind, folder: string) => Promise<boolean> {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName, getNameError } = useWorkspaceSession()

    return useCallback(
        async (kind: NewItemKind, folder: string) => {
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
            const { name: startName, extension } = NEW_FILE[kind]
            const name = await promptName({
                kind,
                folder,
                defaultValue: suggestName(folder, startName),
                // A name typed without an extension gets the one for this kind.
                validate: (value) => getNameError(folder, withDocumentExtension(value, extension), 'file'),
            })
            if (!name) return false
            const fileName = withDocumentExtension(name, extension)
            await createFile(folder, fileName)
            // If the file couldn't be made, its tab never shows and focus stays where it is.
            focusEditorFor(joinPath(folder, fileName))
            return true
        },
        [promptName, createFile, createFolder, suggestName, getNameError]
    )
}

/** New items in one folder, for that folder's menus. Does nothing while `parentPath` is null. */
export function useFileTreeActions(parentPath: string | null) {
    const createNewItem = useCreateNewItem()

    return useMemo(() => {
        const inParent = (kind: NewItemKind) => async () => {
            if (parentPath) await createNewItem(kind, parentPath)
        }
        return {
            createMermaidFileInParent: inParent('new-diagram'),
            createMarkdownFileInParent: inParent('new-document'),
            createFolderInParent: inParent('new-folder'),
        }
    }, [parentPath, createNewItem])
}

export type FileTreeEntryActions = {
    /** Resolves to the path the entry should have now (the new one once renamed), or null when cancelled. */
    renameWithPrompt: (node: FileNode) => Promise<string | null>
    /** Resolves to whether the user confirmed the delete (true even when it then failed or was stopped). */
    deleteWithConfirm: (node: FileNode) => Promise<boolean>
}

/** Rename and delete for a file or folder in the tree, shared by its menus and the F2 and Delete keys. */
export function useFileTreeEntryActions(): FileTreeEntryActions {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { renameEntry, deleteEntry, getNameError } = useWorkspaceSession()

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

    return { renameWithPrompt, deleteWithConfirm }
}

const TreeEntryActionsContext = createContext<FileTreeEntryActions | null>(null)

/** FileTree gives its row menus the rename and delete its keys use, which also put focus back on a row afterwards. */
export const TreeEntryActionsProvider = TreeEntryActionsContext.Provider

/** Rename and delete for a row's menu: the tree's own inside a FileTree, else the plain ones. */
export function useRowEntryActions(): FileTreeEntryActions {
    const plain = useFileTreeEntryActions()
    return useContext(TreeEntryActionsContext) ?? plain
}
