import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { revealSetting } from '@/components/studio/settings/settings-search-results'

/** A section with a setting at the top, then a switch and the setting it turns on. */
function Section() {
    return (
        <div data-testid="panel" tabIndex={-1}>
            <div data-slot="field">
                <span>Font size</span>
                <input aria-label="Font size" />
            </div>
            <div data-slot="field">
                <span>Spell check</span>
                <button type="button" role="switch" aria-checked="false" aria-label="Spell check" />
            </div>
            <div data-slot="field">
                <span>Language</span>
                <input aria-label="Language" disabled />
            </div>
        </div>
    )
}

describe('revealSetting', () => {
    it('puts focus on the switch just above a setting that is off, not the first control in the section', () => {
        render(<Section />)

        revealSetting(screen.getByTestId('panel'), { section: 'editor', label: 'Language' })

        expect(screen.getByRole('switch', { name: 'Spell check' })).toHaveFocus()
    })

    it('falls back to the first control when no switch sits above the setting', () => {
        render(<Section />)
        screen.getByRole('switch', { name: 'Spell check' }).setAttribute('disabled', '')

        revealSetting(screen.getByTestId('panel'), { section: 'editor', label: 'Language' })

        expect(screen.getByRole('textbox', { name: 'Font size' })).toHaveFocus()
    })

    it('puts focus on the section when the setting is not there', () => {
        render(<Section />)

        revealSetting(screen.getByTestId('panel'), { section: 'editor', label: 'Not a setting' })

        expect(screen.getByTestId('panel')).toHaveFocus()
    })
})
