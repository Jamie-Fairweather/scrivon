'use client'

import { useCallback } from 'react'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useFileTreeActions(parentPath: string | null) {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName, getNameError } = useWorkspaceSession()

    const createMermaidFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New diagram name',
            defaultValue: suggestName(parentPath, 'diagram.mmd'),
            placeholder: 'diagram.mmd',
            validate: (value) => getNameError(parentPath, value, 'file'),
        })
        if (name) await createFile(parentPath, name)
    }, [parentPath, promptName, createFile, suggestName, getNameError])

    const createMarkdownFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName({
            title: 'New document name',
            defaultValue: suggestName(parentPath, 'document.md'),
            placeholder: 'document.md',
            validate: (value) => getNameError(parentPath, value, 'file'),
        })
        if (name) await createFile(parentPath, name)
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
