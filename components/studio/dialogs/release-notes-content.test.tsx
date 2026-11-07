import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReleaseNotesContent } from './release-notes-content'

describe('ReleaseNotesContent', () => {
    it('renders numbered lists, tables, strikethrough and inline code from release notes', () => {
        const notes = [
            '## [1.4.2]',
            '',
            '1. First step',
            '2. Second step',
            '',
            '| Key | Action |',
            '| --- | --- |',
            '| Ctrl+B | Explorer |',
            '',
            '~~old~~ and `code`',
        ].join('\n')

        const { container } = render(<ReleaseNotesContent notes={notes} />)

        expect(screen.getByRole('list')).toContainHTML('First step')
        expect(container.querySelector('ol')).not.toBeNull()
        expect(screen.getByRole('table')).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Key' })).toBeInTheDocument()
        expect(container.querySelector('del')).toHaveTextContent('old')
        expect(container.querySelector('code')).toHaveTextContent('code')
    })
})
