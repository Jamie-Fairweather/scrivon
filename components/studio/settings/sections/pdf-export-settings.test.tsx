import { invoke } from '@tauri-apps/api/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfExportSettings } from '@/components/studio/settings/sections/pdf-export-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { getActivePdfExportProfile, updatePdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { isTauri, isWindowsTauri } from '@/lib/tauri/platform'

type UpdateSettings = ReturnType<typeof useAppSettings>['updateSettings']
let updateSettings: UpdateSettings

/** Shows the saved profile names (and mono font) so tests can check what actually got stored. */
function SavedNames() {
    const { settings, updateSettings: update } = useAppSettings()
    useEffect(() => {
        updateSettings = update
    }, [update])
    const { profiles } = settings.pdfExport
    const active = getActivePdfExportProfile(settings.pdfExport)
    const { size, customSizeMm } = active.page
    return (
        <>
            <output data-testid="saved-names">{profiles.map((profile) => profile.name).join('|')}</output>
            <output data-testid="saved-mono-font">{active.typography.monoFont}</output>
            <output data-testid="saved-page">{`${size} ${customSizeMm.width}×${customSizeMm.height}`}</output>
            <output data-testid="saved-code-theme">{active.content.codeTheme}</output>
            <output data-testid="saved-toc-title">{active.frontMatter.tocTitle}</output>
        </>
    )
}

function renderSection() {
    render(
        <SettingsProvider>
            <PdfExportSettings />
            <SavedNames />
        </SettingsProvider>
    )
}

/** Renders the section, then applies `change` to the active profile. */
function renderWithProfile(change: (profile: PdfExportProfile) => PdfExportProfile) {
    renderSection()
    act(() =>
        updateSettings((current) => ({
            ...current,
            pdfExport: updatePdfExportProfile(current.pdfExport, current.pdfExport.activeProfileId, change),
        }))
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

    it('keeps footer page numbers usable while the footer is off, but nothing the export then leaves out', async () => {
        renderSection()
        const footer = group('Footer')
        const pageNumbers = footer.getByRole('combobox', { name: 'Page numbers' })
        const hideOn = footer.getByRole('combobox', { name: 'Hide on' })
        const browse = footer.getByRole('button', { name: 'Browse for footer left image' })
        expect(pageNumbers).not.toHaveAttribute('data-disabled')
        expect(hideOn).toHaveAttribute('data-disabled')
        expect(browse).toBeDisabled()

        // With the switch off the export prints the page number alone, so only "Hide on" starts to apply.
        const user = userEvent.setup()
        await user.click(pageNumbers)
        await user.click(await screen.findByRole('option', { name: 'Number' }))
        await waitFor(() => expect(hideOn).not.toHaveAttribute('data-disabled'))
        expect(browse).toBeDisabled()
        expect(footer.getByRole('switch', { name: 'Ignore margins' })).toHaveAttribute('data-disabled')

        fireEvent.click(footer.getByRole('switch', { name: 'Show footer' }))
        expect(browse).toBeEnabled()
    })

    it('numbers pages from the body when that switch is on, even with the footer off (F48)', () => {
        renderSection()
        const fromBody = group('Footer').getByRole('switch', { name: 'Number pages from the body' })
        expect(fromBody).toHaveAttribute('aria-checked', 'false')
        // It also numbers the Contents page, so it works with the footer off.
        expect(fromBody).not.toHaveAttribute('data-disabled')

        fireEvent.click(fromBody)
        expect(fromBody).toHaveAttribute('aria-checked', 'true')
    })
})

describe('PdfExportSettings page space', () => {
    const group = (name: string) => within(screen.getByRole('group', { name }))
    const bar = (ignoreMargins: boolean) => ({ enabled: true, heightMm: 60, gapMm: 60, ignoreMargins })

    it('says nothing while the text has room', () => {
        renderSection()
        expect(screen.queryByText(/page height for the text|no room left for the text/)).toBeNull()
    })

    it('warns next to the margins and the bar sizes when little room is left', () => {
        renderWithProfile((profile) => ({ ...profile, header: { ...profile.header, ...bar(false) }, footer: { ...profile.footer, ...bar(false) } }))
        // A4 portrait: 297 - (10 + 120) - (10 + 120).
        const message = 'Margins, header and footer leave only 37 mm of page height for the text.'
        expect(group('Page').getByText(message)).toBeInTheDocument()
        expect(group('Header').getByText(message)).toBeInTheDocument()
        expect(group('Footer').getByText(message)).toBeInTheDocument()
    })

    it('says when the bars are taller than a landscape page', () => {
        renderWithProfile((profile) => ({
            ...profile,
            page: { ...profile.page, orientation: 'landscape' },
            header: { ...profile.header, ...bar(true) },
            footer: { ...profile.footer, ...bar(true) },
        }))
        expect(group('Page').getByText(/taller than the page, so there is no room left for the text/)).toBeInTheDocument()
    })

    it('warns under the margins when a narrow custom page leaves the text little width', () => {
        renderWithProfile((profile) => ({
            ...profile,
            page: {
                ...profile.page,
                size: 'custom',
                customSizeMm: { width: 120, height: 200 },
                marginsMm: { top: 10, right: 45, bottom: 10, left: 45 },
            },
        }))
        expect(group('Page').getByText('The side margins leave only 30 mm of page width for the text.')).toBeInTheDocument()
    })

    it('does not count the size of a switched-off footer that only prints page numbers', () => {
        renderWithProfile((profile) => ({
            ...profile,
            page: { ...profile.page, orientation: 'landscape' },
            header: { ...profile.header, ...bar(false) },
            footer: { ...profile.footer, heightMm: 60, gapMm: 60, pageNumbers: 'number' },
        }))
        // Landscape A4: 210 - (10 + 120) - 10 leaves 70 mm, so no warning.
        expect(screen.queryByText(/page height for the text|no room left for the text/)).toBeNull()
    })
})

describe('PdfExportSettings page size', () => {
    const typeInto = (input: HTMLElement, text: string) => {
        act(() => input.focus())
        fireEvent.change(input, { target: { value: text } })
        fireEvent.blur(input)
    }

    it('offers A3, A5, Legal and a custom size', async () => {
        renderSection()
        const user = userEvent.setup()
        await user.click(screen.getByRole('combobox', { name: 'Page size' }))
        for (const name of [
            'A3 (297 × 420 mm)',
            'A4 (210 × 297 mm)',
            'A5 (148 × 210 mm)',
            'Letter (8.5 × 11 in)',
            'Legal (8.5 × 14 in)',
            'Custom size',
        ])
            expect(await screen.findByRole('option', { name })).toBeInTheDocument()
    })

    it('asks for a width and height only for a custom size, and saves them', async () => {
        renderSection()
        expect(screen.queryByRole('textbox', { name: 'Page width (mm)' })).toBeNull()

        const user = userEvent.setup()
        await user.click(screen.getByRole('combobox', { name: 'Page size' }))
        await user.click(await screen.findByRole('option', { name: 'Custom size' }))
        const width = await screen.findByRole('textbox', { name: 'Page width (mm)' })
        expect(width).toHaveValue('210')
        typeInto(width, '120')
        typeInto(screen.getByRole('textbox', { name: 'Page height (mm)' }), '9000')
        expect(screen.getByTestId('saved-page')).toHaveTextContent('custom 120×550')
    })
})

describe('PdfExportSettings code theme', () => {
    it('offers the newer code themes and saves the one picked', async () => {
        renderSection()
        const user = userEvent.setup()
        await user.click(screen.getByRole('combobox', { name: 'Code theme' }))
        await user.click(await screen.findByRole('option', { name: 'Solarized Light' }))
        expect(screen.getByTestId('saved-code-theme')).toHaveTextContent('solarized-light')
        await user.click(screen.getByRole('combobox', { name: 'Code theme' }))
        expect(await screen.findByRole('option', { name: 'Nord (dark)' })).toBeInTheDocument()
    })
})

describe('PdfExportSettings table of contents', () => {
    const empty = /no headings are left, so no table of contents is added/

    it('saves the Contents title, and keeps it off until the table of contents is on', () => {
        renderSection()
        const title = screen.getByRole('textbox', { name: 'Contents title' })
        expect(title).toBeDisabled()
        expect(title).toHaveValue('Contents')

        fireEvent.click(screen.getByRole('switch', { name: 'Include a table of contents' }))
        fireEvent.change(title, { target: { value: 'Sommaire' } })
        expect(screen.getByTestId('saved-toc-title')).toHaveTextContent('Sommaire')
    })

    it('warns when depth H1 and Exclude H1 leave the table of contents empty', async () => {
        renderWithProfile((profile) => ({ ...profile, frontMatter: { ...profile.frontMatter, toc: true } }))
        expect(screen.queryByText(empty)).toBeNull()

        const user = userEvent.setup()
        await user.click(screen.getByRole('combobox', { name: 'TOC depth' }))
        await user.click(await screen.findByRole('option', { name: 'H1' }))
        expect(await screen.findByText(empty)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('switch', { name: 'Exclude H1 from TOC' }))
        expect(screen.queryByText(empty)).toBeNull()
    })

    it('says nothing while the table of contents is off', () => {
        renderWithProfile((profile) => ({ ...profile, frontMatter: { ...profile.frontMatter, toc: false, tocDepth: 1, tocExcludeH1: true } }))
        expect(screen.queryByText(empty)).toBeNull()
    })
})

describe('PdfExportSettings fonts', () => {
    const withMonoFont = (monoFont: string) => (profile: PdfExportProfile) => ({ ...profile, typography: { ...profile.typography, monoFont } })

    it('shows a font saved by an older build under its own name', () => {
        renderWithProfile((profile) => ({ ...profile, typography: { ...profile.typography, bodyFont: 'Arial, sans-serif' } }))
        expect(screen.getByRole('combobox', { name: 'Body font' })).toHaveValue('Arial')
    })

    it('names a saved font that is not in the list instead of calling it "Current"', () => {
        renderWithProfile(withMonoFont('"Fira Code", monospace'))
        expect(screen.getByRole('combobox', { name: 'Monospace font' })).toHaveValue('Fira Code')
    })

    it('lists only monospaced fonts for Monospace, keeping a saved one apart', async () => {
        renderWithProfile(withMonoFont('Arial, Helvetica, sans-serif'))
        const input = screen.getByRole('combobox', { name: 'Monospace font' })
        expect(input).toHaveValue('Arial')
        await userEvent.setup().click(input)
        const listbox = await screen.findByRole('listbox')
        const group = (name: string) =>
            within(within(listbox).getByText(name).closest('[role="group"]') as HTMLElement)
                .getAllByRole('option')
                .map((option) => option.textContent)
        expect(group('Saved font')).toEqual(['Arial'])
        expect(group('Common fonts')).toEqual(['Consolas', 'Courier New', 'Monaco', 'UI Monospace'])
    })

    it('filters the list as you type and saves the font picked', async () => {
        renderWithProfile(withMonoFont('"Fira Code", monospace'))
        const user = userEvent.setup()
        const input = screen.getByRole('combobox', { name: 'Monospace font' })
        await user.clear(input)
        await user.type(input, 'cons')
        const listbox = await screen.findByRole('listbox')
        expect(
            within(listbox)
                .getAllByRole('option')
                .map((option) => option.textContent)
        ).toEqual(['Consolas'])
        expect(within(listbox).getByText('Common fonts')).toBeInTheDocument()

        await user.click(within(listbox).getByRole('option', { name: 'Consolas' }))
        expect(input).toHaveValue('Consolas')
        expect(screen.getByTestId('saved-mono-font')).toHaveTextContent('Consolas, "Courier New", monospace')
    })

    it('keeps what you typed when the installed fonts finish loading', async () => {
        let finishLoading: (fonts: { family: string; monospace: boolean }[]) => void = () => {}
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockImplementation((command) =>
            command === 'list_system_fonts'
                ? new Promise((resolve) => {
                      finishLoading = resolve
                  })
                : Promise.resolve(undefined)
        )
        try {
            renderWithProfile(withMonoFont('"Fira Code", monospace'))
            const user = userEvent.setup()
            const input = screen.getByRole('combobox', { name: 'Monospace font' })
            await user.clear(input)
            await user.type(input, 'cons')

            // No installed fonts, so nothing is kept for later tests, but the list still changes.
            await act(async () => finishLoading([]))
            expect(input).toHaveValue('cons')
            const options = within(await screen.findByRole('listbox')).getAllByRole('option')
            expect(options.map((option) => option.textContent)).toEqual(['Consolas'])
        } finally {
            vi.mocked(isTauri).mockReturnValue(false)
            vi.mocked(invoke).mockImplementation(async () => undefined)
        }
    })
})

describe('PdfExportSettings labels', () => {
    const group = (name: string) => within(screen.getByRole('group', { name }))

    it('says the profile styles HTML export too, not just PDF and Word', () => {
        renderSection()
        expect(screen.getByRole('combobox', { name: 'Default export profile' })).toHaveAccessibleDescription(
            /^Styles for PDF, Word and HTML export\./
        )
        expect(screen.getByText('Multiple of the font size, in PDF, Word and HTML.')).toBeInTheDocument()
    })

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

    it('lists every placeholder the header and footer text can use', async () => {
        renderSection()
        expect(group('Header').getAllByText('Use {{title}}, {{subtitle}}, {{author}} or {{date}} (today if no date is set).')).toHaveLength(2)
        const user = userEvent.setup()
        await user.click(group('Footer').getByRole('combobox', { name: 'Page numbers' }))
        await user.click(await screen.findByRole('option', { name: 'Custom text' }))
        const hint = await group('Footer').findByText(
            /^Use \{\{page\}\}, \{\{total\}\}, \{\{title\}\}, \{\{subtitle\}\}, \{\{author\}\} or \{\{date\}\}\./
        )
        expect(hint).toHaveTextContent('Between {{page}} and {{total}}, Arabic, Hebrew, Hindi and letters the footer font lacks print as ?.')
    })

    it('says which page numbers may be lost outside the Windows app, and only there', () => {
        const note = 'Outside the Windows app, the table of contents has no page numbers and footer numbers may not print.'
        renderSection()
        expect(group('Footer').getByText(note)).toBeInTheDocument()
        cleanup()

        vi.mocked(isWindowsTauri).mockReturnValue(true)
        try {
            renderSection()
            expect(screen.queryByText(note)).toBeNull()
        } finally {
            vi.mocked(isWindowsTauri).mockReturnValue(false)
        }
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

    it('moves focus to the profile picker when Delete is disabled after deleting', async () => {
        renderSection()
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Duplicate' }))
        await user.click(screen.getByRole('button', { name: 'Delete' }))
        await user.click(await screen.findByRole('button', { name: 'Delete profile' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

        expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Default export profile' })).toHaveFocus())
    })

    it('still returns focus to Delete after Cancel', async () => {
        renderSection()
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Duplicate' }))
        const del = screen.getByRole('button', { name: 'Delete' })
        await user.click(del)
        await user.click(await screen.findByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        await waitFor(() => expect(del).toHaveFocus())
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

    it('lets the box be cleared, and leaving it empty puts the starting name back', () => {
        renderSection()
        const input = screen.getByLabelText('Profile name')
        fireEvent.focus(input)

        fireEvent.change(input, { target: { value: 'Brand ' } })
        fireEvent.change(input, { target: { value: '' } })
        expect(input).toHaveValue('')
        expect(savedNames()).toBe('Brand')

        fireEvent.blur(input)
        expect(input).toHaveValue('Default')
        expect(savedNames()).toBe('Default')
    })

    it('points out a name another profile already has, without stopping the typing', () => {
        renderSection()
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        const input = screen.getByLabelText('Profile name')
        const twin = 'Another profile is already called "Default".'
        expect(screen.queryByText(twin)).toBeNull()

        fireEvent.change(input, { target: { value: 'default ' } })
        expect(input).toHaveValue('default ')
        expect(savedNames()).toBe('Default|default')
        expect(input).toHaveAccessibleDescription(twin)

        fireEvent.change(input, { target: { value: 'default 2' } })
        expect(screen.queryByText(twin)).toBeNull()
    })

    it('puts the starting name back after backspacing it away and leaving the box', async () => {
        renderSection()
        const input = screen.getByLabelText('Profile name')
        const user = userEvent.setup()
        await user.click(input)
        await user.keyboard('{End}' + '{Backspace}'.repeat('Default'.length))
        expect(input).toHaveValue('')
        // Each keystroke saved a shorter name, down to the first letter.
        expect(savedNames()).toBe('D')

        await user.tab()
        expect(input).toHaveValue('Default')
        expect(savedNames()).toBe('Default')
    })

    it('Escape cancels the rename, and only then lets Settings close', async () => {
        renderSection()
        const input = screen.getByLabelText('Profile name')
        const user = userEvent.setup()
        await user.click(input)
        await user.keyboard('{End} Brand')
        expect(savedNames()).toBe('Default Brand')

        const onDocumentEscape = vi.fn()
        document.addEventListener('keydown', onDocumentEscape)
        try {
            await user.keyboard('{Escape}')
            expect(input).toHaveValue('Default')
            expect(savedNames()).toBe('Default')
            expect(input).toHaveFocus()
            expect(onDocumentEscape).not.toHaveBeenCalled()

            await user.keyboard('{Escape}')
            expect(onDocumentEscape).toHaveBeenCalledTimes(1)
        } finally {
            document.removeEventListener('keydown', onDocumentEscape)
        }
    })
})
