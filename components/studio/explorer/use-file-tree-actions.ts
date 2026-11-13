'use client'

import { createContext, useCallback, useContext } from 'react'
import { useDeleteConfirm } from '@/components/studio/dialogs/delete-confirm-provider'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { getBaseName, getParentPath, joinPath } from '@/lib/tauri/fs'
import { documentExtension, fileExtension, withDocumentExtension } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

/** Names the folder a new item goes in, for the prompt: `Creates the diagram in "docs".` */
function createdIn(what: string, parentPath: string): string {
    return `Creates the ${what} in "${getBaseName(parentPath) || parentPath}".`
}

export function useFileTreeActions(parentPath: string | null) {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName, getNameError } = useWorkspaceSession()

    // The new file opens in a tab, and the editor then takes the keyboard so the user can start typing.
    // If the file couldn't be made, its tab never shows and focus stays where it is.
    const createAndFocus = useCallback(
        async (folder: string, name: string) => {
            await createFile(folder, name)
            focusEditorFor(joinPath(folder, name))
        },
        [createFile]
    )

    const createMermaidFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New diagram name',
            description: createdIn('diagram', parentPath),
            defaultValue: suggestName(parentPath, 'diagram.mmd'),
            placeholder: 'diagram.mmd',
            // A name typed without an extension gets the one this menu item is for.
            validate: (value) => getNameError(parentPath, withDocumentExtension(value, '.mmd'), 'file'),
        })
        if (name) await createAndFocus(parentPath, withDocumentExtension(name, '.mmd'))
    }, [parentPath, promptName, createAndFocus, suggestName, getNameError])

    const createMarkdownFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New document name',
            description: createdIn('document', parentPath),
            defaultValue: suggestName(parentPath, 'document.md'),
            placeholder: 'document.md',
            validate: (value) => getNameError(parentPath, withDocumentExtension(value, '.md'), 'file'),
        })
        if (name) await createAndFocus(parentPath, withDocumentExtension(name, '.md'))
    }, [parentPath, promptName, createAndFocus, suggestName, getNameError])

    const createFolderInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New folder name',
            description: createdIn('folder', parentPath),
            defaultValue: suggestName(parentPath, 'diagrams'),
            placeholder: 'Folder name',
            validate: (value) => getNameError(parentPath, value, 'directory'),
        })
        if (name) await createFolder(parentPath, name)
    }, [parentPath, promptName, createFolder, suggestName, getNameError])

    return { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent }
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
                title: `Rename "${node.name}"`,
                description: `Choose a new name for this ${node.kind === 'directory' ? 'folder' : 'file'}.`,
                submitLabel: 'Rename',
                defaultValue: node.name,
                extension,
                placeholder: node.name,
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
