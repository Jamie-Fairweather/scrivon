import { describe, expect, it } from 'vitest'
import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { isSupportedDocument } from '@/lib/workspace/file-types'
import { validateFileName } from '@/lib/workspace/paths'
import { exampleFileName, exampleIdFromTabId, exampleTabId, isExampleTabId, tabFromExample } from './example-tab'
import type { AppExample } from './types'

const mermaidExample: AppExample = {
    id: 'sample-1',
    category: 'flowchart',
    title: 'Simple Flow',
    description: 'Example',
    source: 'graph TD\n  A --> B',
}

const markdownExample: AppExample = {
    id: 'markdown-showcase',
    category: 'markdown',
    title: 'Markdown Showcase',
    description: 'Example',
    source: '# Hello',
}

describe('exampleTabId', () => {
    it('prefixes example ids', () => {
        expect(exampleTabId('sample-1')).toBe('example:sample-1')
    })
})

describe('isExampleTabId', () => {
    it('detects example tab ids', () => {
        expect(isExampleTabId('example:sample-1')).toBe(true)
        expect(isExampleTabId('/ws/diagram.mmd')).toBe(false)
    })
})

describe('exampleIdFromTabId', () => {
    it('gives the example id of an example tab, and null for a file', () => {
        expect(exampleIdFromTabId('example:sample-1')).toBe('sample-1')
        expect(exampleIdFromTabId('C:\ws\diagram.mmd')).toBeNull()
    })
})

describe('exampleFileName', () => {
    const named = (title: string, category: AppExample['category'] = 'flowchart') => exampleFileName({ ...mermaidExample, title, category })

    it('names the file after the example, with the extension for its kind', () => {
        expect(named('Simple Flow')).toBe('Simple Flow.mmd')
        expect(named('Markdown Showcase', 'markdown')).toBe('Markdown Showcase.md')
    })

    it('drops or swaps characters Windows does not allow in a file name', () => {
        expect(named('CI/CD Pipeline')).toBe('CI-CD Pipeline.mmd')
        expect(named('Inheritance (<|--)')).toBe('Inheritance (--).mmd')
        expect(named('::: Class Shorthand')).toBe('Class Shorthand.mmd')
        expect(named('Direction: Left-Right (LR)')).toBe('Direction Left-Right (LR).mmd')
        expect(named('Version 2.')).toBe('Version 2.mmd')
    })

    it('falls back to a plain name when nothing usable is left', () => {
        expect(named(':::')).toBe('example.mmd')
        expect(named('CON')).toBe('example.mmd')
    })

    it('gives every built-in example a name that can be saved and opened', () => {
        for (const example of APP_EXAMPLES) {
            const name = exampleFileName(example)
            expect(validateFileName(name), name).toBeNull()
            expect(isSupportedDocument(name), name).toBe(true)
        }
    })
})

describe('tabFromExample', () => {
    it('creates a read-only mermaid tab', () => {
        expect(tabFromExample(mermaidExample)).toMatchObject({
            id: 'example:sample-1',
            name: 'Simple Flow.mmd',
            readOnly: true,
            content: mermaidExample.source,
        })
    })

    it('uses .md extension for markdown examples', () => {
        expect(tabFromExample(markdownExample).name).toBe('Markdown Showcase.md')
    })
})
