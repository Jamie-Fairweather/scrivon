import type { AppExample } from '@/lib/examples/types'
import type { DocumentTab } from '@/lib/workspace/types'

export function exampleTabId(id: string): string {
    return `example:${id}`
}

export function isExampleTabId(tabId: string): boolean {
    return tabId.startsWith('example:')
}

export function tabFromExample(example: AppExample): DocumentTab {
    const id = exampleTabId(example.id)
    const extension = example.category === 'markdown' ? '.md' : '.mmd'
    return {
        id,
        path: id,
        name: `${example.title}${extension}`,
        content: example.source,
        isDirty: false,
        isSaving: false,
        readOnly: true,
    }
}
