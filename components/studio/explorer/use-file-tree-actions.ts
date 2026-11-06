'use client'

import { useCallback } from 'react'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { withDocumentExtension } from '@/lib/workspace/file-types'

export function useFileTreeActions(parentPath: string | null) {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName, getNameError } = useWorkspaceSession()

    const createMermaidFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New diagram name',
            defaultValue: suggestName(parentPath, 'diagram.mmd'),
            placeholder: 'diagram.mmd',
            // A name typed without an extension gets the one this menu item is for.
            validate: (value) => getNameError(parentPath, withDocumentExtension(value, '.mmd'), 'file'),
        })
        if (name) await createFile(parentPath, withDocumentExtension(name, '.mmd'))
    }, [parentPath, promptName, createFile, suggestName, getNameError])

    const createMarkdownFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New document name',
            defaultValue: suggestName(parentPath, 'document.md'),
            placeholder: 'document.md',
            validate: (value) => getNameError(parentPath, withDocumentExtension(value, '.md'), 'file'),
        })
        if (name) await createFile(parentPath, withDocumentExtension(name, '.md'))
    }, [parentPath, promptName, createFile, suggestName, getNameError])

    const createFolderInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New folder name',
            defaultValue: suggestName(parentPath, 'diagrams'),
            placeholder: 'Folder name',
            validate: (value) => getNameError(parentPath, value, 'directory'),
        })
        if (name) await createFolder(parentPath, name)
    }, [parentPath, promptName, createFolder, suggestName, getNameError])

    return { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent }
}
