import type { AppExample } from '@/lib/examples/types'
import { safeFileStem, validateFileName } from '@/lib/workspace/paths'
import type { DocumentTab } from '@/lib/workspace/types'

const EXAMPLE_TAB_PREFIX = 'example:'

export function exampleTabId(id: string): string {
    return `${EXAMPLE_TAB_PREFIX}${id}`
}

export function isExampleTabId(tabId: string): boolean {
    return tabId.startsWith(EXAMPLE_TAB_PREFIX)
}

/** The example an example tab shows, or null for any other tab. */
export function exampleIdFromTabId(tabId: string): string | null {
    return isExampleTabId(tabId) ? tabId.slice(EXAMPLE_TAB_PREFIX.length) : null
}

function exampleExtension(example: AppExample): string {
    return example.category === 'markdown' ? '.md' : '.mmd'
}

/**
 * A file name for a copy of the example: its title made safe for Windows, the same way diagram
 * exports are ('CI/CD Pipeline' -> 'CI-CD Pipeline.mmd'), or 'example' when nothing usable is left.
 */
export function exampleFileName(example: AppExample): string {
    const extension = exampleExtension(example)
    const name = `${safeFileStem(example.title, 'example')}${extension}`
    return validateFileName(name) === null ? name : `example${extension}`
}

export function tabFromExample(example: AppExample): DocumentTab {
    const id = exampleTabId(example.id)
    return {
        id,
        path: id,
        name: `${example.title}${exampleExtension(example)}`,
        content: example.source,
        isDirty: false,
        isSaving: false,
        readOnly: true,
    }
}
