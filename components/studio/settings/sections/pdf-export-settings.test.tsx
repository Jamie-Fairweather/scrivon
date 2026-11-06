import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('PdfExportSettings groups', () => {
    const group = (name: string) => within(screen.getByRole('group', { name }))

    it('puts the settings under named groups', () => {
        renderSection()
        for (const name of ['Page', 'Text', 'Colours', 'Title page', 'Table of contents', 'Header', 'Footer', 'Content']) {
            expect(screen.getByRole('group', { name })).toBeInTheDocument()
        }
    })

    it('disables the cover image settings until the title page is on', () => {
        renderSection()
        const titlePage = group('Title page')
        const browse = titlePage.getByRole('button', { name: 'Browse for cover image' })
        const bleed = titlePage.getByRole('switch', { name: 'Cover image ignores margins' })
        expect(browse).toBeDisabled()
        expect(bleed).toHaveAttribute('data-disabled')

        fireEvent.click(titlePage.getByRole('switch', { name: 'Include a title page' }))
        expect(browse).toBeEnabled()
        expect(bleed).not.toHaveAttribute('data-disabled')
    })

    it('disables TOC depth and Exclude H1 until the table of contents is on', () => {
        renderSection()
        const toc = group('Table of contents')
        expect(screen.getByLabelText('TOC depth')).toHaveAttribute('data-disabled')
        expect(toc.getByRole('switch', { name: 'Exclude H1 from TOC' })).toHaveAttribute('data-disabled')

        fireEvent.click(toc.getByRole('switch', { name: 'Include a table of contents' }))
        expect(screen.getByLabelText('TOC depth')).not.toHaveAttribute('data-disabled')
        expect(toc.getByRole('switch', { name: 'Exclude H1 from TOC' })).not.toHaveAttribute('data-disabled')
    })

    it('disables the header fields while the header is off', () => {
        renderSection()
        const header = group('Header')
        expect(header.getByRole('button', { name: 'Browse for header left image' })).toBeDisabled()
        expect(header.getByRole('textbox', { name: 'Left text' })).toBeDisabled()

        fireEvent.click(header.getByRole('switch', { name: 'Show header' }))
        expect(header.getByRole('button', { name: 'Browse for header left image' })).toBeEnabled()
        expect(header.getByRole('textbox', { name: 'Left text' })).toBeEnabled()
    })

    it('keeps footer page numbers usable while the footer is off, and enables the rest once they show', async () => {
        renderSection()
        const footer = group('Footer')
        const pageNumbers = footer.getByRole('combobox', { name: 'Page numbers' })
        expect(pageNumbers).not.toHaveAttribute('data-disabled')
        expect(footer.getByRole('button', { name: 'Browse for footer left image' })).toBeDisabled()

        // The export draws the footer whenever it has page numbers, so its fields apply then too.
        const user = userEvent.setup()
        await user.click(pageNumbers)
        await user.click(await screen.findByRole('option', { name: 'Number' }))
        await waitFor(() => expect(footer.getByRole('button', { name: 'Browse for footer left image' })).toBeEnabled())
    })
})

describe('PdfExportSettings labels', () => {
    const group = (name: string) => within(screen.getByRole('group', { name }))

    it('names the header and footer colour buttons and still reads their value', () => {
        renderSection()
        for (const name of ['Header', 'Footer']) {
            const background = group(name).getByRole('button', { name: 'Background colour' })
            expect(background).toHaveAccessibleDescription('Transparent')
            expect(group(name).getByRole('button', { name: 'Font colour' })).toHaveAccessibleDescription('Default')
        }
        expect(screen.getByRole('button', { name: 'Brand colour' })).toHaveAccessibleDescription('#262626')
    })

    it('says which image each Browse button is for', () => {
        renderSection()
        for (const name of ['cover image', 'header left image', 'header right image', 'footer left image', 'footer right image']) {
            expect(screen.getByRole('button', { name: `Browse for ${name}` })).toBeInTheDocument()
        }
    })

    it('labels the custom page-number text box', async () => {
        renderSection()
        const user = userEvent.setup()
        await user.click(group('Footer').getByRole('combobox', { name: 'Page numbers' }))
        await user.click(await screen.findByRole('option', { name: 'Custom text' }))
        expect(await group('Footer').findByRole('textbox', { name: 'Custom text' })).toBeInTheDocument()
    })
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

describe('PdfExportSettings new and duplicate', () => {
    function expectNameSelected(name: string) {
        const input = screen.getByLabelText<HTMLInputElement>('Profile name')
        expect(input).toHaveValue(name)
        expect(input).toHaveFocus()
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, name.length])
    }

    it('names each new profile uniquely and selects the name to type over', () => {
        renderSection()
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        expectNameSelected('New profile')
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        expectNameSelected('New profile 2')
        expect(savedNames()).toBe('Default|New profile|New profile 2')
    })

    it('selects the name of a duplicate too', () => {
        renderSection()
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
        expectNameSelected('Default copy')
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
        expectNameSelected('Default copy 2')
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
