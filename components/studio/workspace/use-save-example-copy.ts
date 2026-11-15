'use client'

import { useCallback } from 'react'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_EXAMPLE_BY_ID } from '@/lib/examples/app-samples'
import { exampleFileName } from '@/lib/examples/example-tab'
import { notifyError } from '@/lib/notify'
import { joinPath, listFolderNames } from '@/lib/tauri/fs'
import { uniqueNewName } from '@/lib/workspace/paths'

/**
 * Saves a copy of an example at the top of the open folder, under a name nothing there uses
 * ('Simple Flow.mmd', then 'Simple Flow 2.mmd'…), and opens it. Never writes over a file.
 */
export function useSaveExampleCopy(): (exampleId: string) => Promise<void> {
    const { workspaceRoot, tree, createFile } = useWorkspaceSession()

    return useCallback(
        async (exampleId: string) => {
            const example = APP_EXAMPLE_BY_ID[exampleId]
            if (!workspaceRoot || !example) return
            let name: string
            try {
                // Names on disk too, so a file added since the list was read isn't picked (the write refuses it anyway).
                const taken = [...(await listFolderNames(workspaceRoot)), ...tree.map((node) => node.name)]
                name = uniqueNewName(exampleFileName(example), taken)
            } catch (err) {
                notifyError(`Couldn't save a copy of ${example.title}`, err)
                return
            }
            // createFile says why if it fails, and opens the new file when it works.
            await createFile(workspaceRoot, name, example.source)
            focusEditorFor(joinPath(workspaceRoot, name))
        },
        [workspaceRoot, tree, createFile]
    )
}
