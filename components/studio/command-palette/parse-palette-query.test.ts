import { describe, expect, it } from 'vitest'
import { parsePaletteQuery, queryFromEditorSelection } from '@/components/studio/command-palette/parse-palette-query'

describe('parsePaletteQuery', () => {
    it('switches to commands when the query starts with >', () => {
        expect(parsePaletteQuery('  > save')).toEqual({ kind: 'commands', query: 'save' })
    })

    it('trims a normal query', () => {
        expect(parsePaletteQuery('  readme  ')).toEqual({ kind: 'search', query: 'readme' })
    })

    it.each([
        [':120', 'line', '120'],
        [' : 120:5 ', 'line', '120:5'],
        ['@install', 'heading', 'install'],
        ['@', 'heading', ''],
        ['?', 'help', ''],
        ['? line', 'help', 'line'],
    ] as const)('reads %j as the %s prefix', (raw, kind, query) => {
        expect(parsePaletteQuery(raw)).toEqual({ kind, query })
    })

    it('reads the prefixes in Go to File too', () => {
        expect(parsePaletteQuery(':12', 'files')).toEqual({ kind: 'line', query: '12' })
    })

    it('searches for :, @ and ? as text in Find in Workspace, where only > switches', () => {
        expect(parsePaletteQuery('@media', 'text')).toEqual({ kind: 'search', query: '@media' })
        expect(parsePaletteQuery(':root', 'text')).toEqual({ kind: 'search', query: ':root' })
        expect(parsePaletteQuery('?', 'text')).toEqual({ kind: 'search', query: '?' })
        expect(parsePaletteQuery('>save', 'text')).toEqual({ kind: 'commands', query: 'save' })
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

    it('keeps a selection starting with @ or :, which Find in Workspace searches as text', () => {
        expect(queryFromEditorSelection('@media')).toBe('@media')
    })
})
