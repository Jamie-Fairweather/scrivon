import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PdfExportSettings } from '@/components/studio/settings/sections/pdf-export-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

/** Shows the saved profile names so tests can check what actually got stored. */
function SavedNames() {
    const { settings } = useAppSettings()
    return <output data-testid="saved-names">{settings.pdfExport.profiles.map((profile) => profile.name).join('|')}</output>
}

function renderSection() {
    render(
        <SettingsProvider>
            <PdfExportSettings />
            <SavedNames />
        </SettingsProvider>
    )
}

const savedNames = () => screen.getByTestId('saved-names').textContent

beforeEach(() => {
    // Start each test from default settings (the provider reads and writes localStorage).
    window.localStorage?.clear()
})

describe('PdfExportSettings delete profile', () => {
    it('is disabled while only one profile exists', () => {
        renderSection()
        expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    })

    it('asks first, and Cancel keeps the profile', async () => {
        renderSection()
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
        expect(savedNames()).toBe('Default|Default copy')

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        const dialog = await screen.findByRole('alertdialog')
        expect(dialog).toHaveTextContent('Delete profile "Default copy"?')
        expect(savedNames()).toBe('Default|Default copy')

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(savedNames()).toBe('Default|Default copy')
    })

    it('deletes the profile named in the dialog once confirmed', async () => {
        renderSection()
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }))
        expect(savedNames()).toBe('Default')
    })
})

describe('PdfExportSettings profile name', () => {
    it('keeps spaces while typing and saves the trimmed name', () => {
        renderSection()
        const input = screen.getByLabelText('Profile name')
        fireEvent.focus(input)

        fireEvent.change(input, { target: { value: 'Client ' } })
        expect(input).toHaveValue('Client ')
        expect(savedNames()).toBe('Client')

        fireEvent.change(input, { target: { value: 'Client Report' } })
        expect(input).toHaveValue('Client Report')
        expect(savedNames()).toBe('Client Report')
    })

    it('lets the box be cleared and puts the last good name back on blur', () => {
        renderSection()
        const input = screen.getByLabelText('Profile name')
        fireEvent.focus(input)

        fireEvent.change(input, { target: { value: 'Brand ' } })
        fireEvent.change(input, { target: { value: '' } })
        expect(input).toHaveValue('')
        expect(savedNames()).toBe('Brand')

        fireEvent.blur(input)
        expect(input).toHaveValue('Brand')
    })
})
