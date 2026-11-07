import { describe, expect, it } from 'vitest'
import { parsePaletteQuery, queryFromEditorSelection } from '@/components/studio/command-palette/parse-palette-query'

describe('parsePaletteQuery', () => {
    it('switches to commands when the query starts with >', () => {
        expect(parsePaletteQuery('  > save')).toEqual({ actionsOnly: true, query: 'save' })
    })

    it('trims a normal query', () => {
        expect(parsePaletteQuery('  readme  ')).toEqual({ actionsOnly: false, query: 'readme' })
    })
})

describe('queryFromEditorSelection', () => {
    it('uses a single-line selection, trimmed', () => {
        expect(queryFromEditorSelection('  flowchart  ')).toBe('flowchart')
    })

    it('ignores empty or missing selections', () => {
        expect(queryFromEditorSelection(null)).toBeNull()
        expect(queryFromEditorSelection(undefined)).toBeNull()
        expect(queryFromEditorSelection('   ')).toBeNull()
    })

    it('ignores multi-line selections, which can never match a line-by-line search', () => {
        expect(queryFromEditorSelection('graph TD\n  A --> B')).toBeNull()
        expect(queryFromEditorSelection('graph TD\r\n  A --> B')).toBeNull()
    })

    it('ignores selections that would switch the palette to commands', () => {
        expect(queryFromEditorSelection('> a quoted line')).toBeNull()
    })
})
