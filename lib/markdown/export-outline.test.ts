import { describe, expect, it } from 'vitest'
import { extractPdfExportOutline } from '@/lib/markdown/export-outline'

describe('extractPdfExportOutline', () => {
    it('extracts headings with unique ids and respects depth / h1 exclusion', () => {
        const body = `# Title
## One
### Deep
## One
#### Too deep for depth 2
`
        expect(extractPdfExportOutline(body, 2, true)).toEqual([
            { id: 'one', level: 2, text: 'One' },
            { id: 'one-1', level: 2, text: 'One' },
        ])
        expect(extractPdfExportOutline(body, 3, false)[0]).toEqual({ id: 'title', level: 1, text: 'Title' })
    })

    it('ignores empty headings and non-heading lines', () => {
        expect(extractPdfExportOutline('##\nplain\n##  \n## Real', 3, false)).toEqual([{ id: 'real', level: 2, text: 'Real' }])
    })

    it('slugifies punctuation-only headings', () => {
        expect(extractPdfExportOutline('## !!!', 3, false)).toEqual([{ id: 'section', level: 2, text: '!!!' }])
    })
})
