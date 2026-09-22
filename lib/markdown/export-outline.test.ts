import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { collectPdfExportOutline, filterPdfExportOutline } from '@/lib/markdown/export-outline'

function parse(body: string): Root {
    return unified().use(remarkParse).use(remarkGfm).parse(body) as Root
}

describe('collectPdfExportOutline', () => {
    it('collects headings with unique ids and writes them onto the nodes', () => {
        const tree = parse(`# Title
## One
### Deep
## One
#### Four
`)
        const items = collectPdfExportOutline(tree)
        expect(items).toEqual([
            { id: 'title', level: 1, text: 'Title' },
            { id: 'one', level: 2, text: 'One' },
            { id: 'deep', level: 3, text: 'Deep' },
            { id: 'one-1', level: 2, text: 'One' },
            { id: 'four', level: 4, text: 'Four' },
        ])
        const headings = tree.children.filter((node) => node.type === 'heading')
        expect(headings.map((node) => node.data?.hProperties?.id)).toEqual(['title', 'one', 'deep', 'one-1', 'four'])
    })

    it('ignores hashes inside fenced code and counts setext headings', () => {
        const tree = parse('Setext\n======\n\n```bash\n# not a heading\n```\n\n## Real')
        expect(collectPdfExportOutline(tree)).toEqual([
            { id: 'setext', level: 1, text: 'Setext' },
            { id: 'real', level: 2, text: 'Real' },
        ])
    })

    it('uses the plain text of inline markup and slugifies punctuation-only headings', () => {
        const tree = parse('## `code` and *emphasis*\n\n## !!!\n\n##')
        expect(collectPdfExportOutline(tree)).toEqual([
            { id: 'code-and-emphasis', level: 2, text: 'code and emphasis' },
            { id: 'section', level: 2, text: '!!!' },
        ])
    })
})

describe('filterPdfExportOutline', () => {
    it('respects depth and h1 exclusion', () => {
        const items = collectPdfExportOutline(parse('# Title\n## One\n### Deep\n#### Four'))
        expect(filterPdfExportOutline(items, 2, true)).toEqual([{ id: 'one', level: 2, text: 'One' }])
        expect(filterPdfExportOutline(items, 3, false).map((item) => item.id)).toEqual(['title', 'one', 'deep'])
    })
})
