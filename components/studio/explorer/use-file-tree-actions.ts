'use client'

import { createContext, useCallback, useContext } from 'react'
import { useDeleteConfirm } from '@/components/studio/dialogs/delete-confirm-provider'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { getBaseName, getParentPath, joinPath } from '@/lib/tauri/fs'
import { documentExtension, withDocumentExtension } from '@/lib/workspace/file-types'
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
    deleteWithConfirm: (node: FileNode) => Promise<void>
}

/** Rename and delete for a file or folder in the tree, shared by its menus and the F2 and Delete keys. */
export function useFileTreeEntryActions(): FileTreeEntryActions {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { renameEntry, deleteEntry, getNameError } = useWorkspaceSession()

    const renameWithPrompt = useCallback(
        async (node: FileNode): Promise<string | null> => {
            const folder = getParentPath(node.path)
            // A file renamed without an extension keeps its current one ('notes.md' -> 'meeting' -> 'meeting.md').
            const extension = node.kind === 'file' ? documentExtension(node.name) : null
            const finalName = (value: string) => (extension ? withDocumentExtension(value, extension) : value)
            const name = await promptName({
                title: `Rename "${node.name}"`,
                description: `Choose a new name for this ${node.kind === 'directory' ? 'folder' : 'file'}.`,
                submitLabel: 'Rename',
                defaultValue: node.name,
                placeholder: node.name,
                validate: (value) => getNameError(folder, finalName(value), node.kind, node.path),
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
            const ok = await confirmDelete(node.name, node.kind === 'directory')
            if (ok) await deleteEntry(node.path, node.kind === 'directory')
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
