import type { CraftExample } from '@/lib/examples/craft-samples'
import type { DocumentTab } from '@/lib/workspace/types'

export function exampleTabId(id: string): string {
    return `example:${id}`
}

export function isExampleTabId(tabId: string): boolean {
    return tabId.startsWith('example:')
}

export function tabFromExample(example: CraftExample): DocumentTab {
    const id = exampleTabId(example.id)
    return {
        id,
        path: id,
        name: example.title,
        content: example.source,
        isDirty: false,
        isSaving: false,
        readOnly: true,
    }
}
