import type { AppExample } from '@/lib/examples/types'
import { validateFileName } from '@/lib/workspace/paths'
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
 * A file name for a copy of the example: its title, minus the characters Windows won't allow
 * ('CI/CD Pipeline' -> 'CI-CD Pipeline.mmd'), or 'example' when nothing usable is left.
 */
export function exampleFileName(example: AppExample): string {
    const stem = example.title
        .replace(/[/\\]/g, '-')
        .replace(/[<>:"|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[\s.]+$/, '')
        .trim()
    const name = `${stem}${exampleExtension(example)}`
    return stem && validateFileName(name) === null ? name : `example${exampleExtension(example)}`
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
