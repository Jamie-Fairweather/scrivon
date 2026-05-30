import { describe, expect, it } from 'vitest'
import { exampleTabId, isExampleTabId, tabFromExample } from './example-tab'
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
