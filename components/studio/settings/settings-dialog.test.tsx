import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/components/studio/settings/settings-dialog'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { settingsSearchEntries } from '@/components/studio/settings/settings-search'
import { findSetting } from '@/components/studio/settings/settings-search-results'
import { getSettingsSectionLabel, SETTINGS_SECTIONS } from '@/components/studio/settings/settings-nav'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/storage'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'

const advanced = vi.hoisted(() => ({ broken: false }))
const pdfExport = vi.hoisted(() => ({ broken: false }))
const nav = vi.hoisted(() => ({ brokenLabelFor: null as string | null }))

// The Advanced section as it is, unless a test breaks it.
vi.mock('@/components/studio/settings/sections/advanced-settings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/studio/settings/sections/advanced-settings')>()
    return {
        AdvancedSettings: () => {
            if (advanced.broken) throw new Error('bad setting')
            return <actual.AdvancedSettings />
        },
    }
})

// The Document export section as it is, unless a test breaks it.
vi.mock('@/components/studio/settings/sections/pdf-export-settings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/studio/settings/sections/pdf-export-settings')>()
    return {
        PdfExportSettings: () => {
            if (pdfExport.broken) throw new Error('bad profile')
            return <actual.PdfExportSettings />
        },
    }
})

// The section labels as they are, unless a test breaks the one in the section's heading (outside the section itself).
vi.mock('@/components/studio/settings/settings-nav', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/studio/settings/settings-nav')>()
    return {
        ...actual,
        getSettingsSectionLabel: (section: Parameters<typeof actual.getSettingsSectionLabel>[0]) => {
            if (section === nav.brokenLabelFor) throw new Error('bad label')
            return actual.getSettingsSectionLabel(section)
        },
    }
})

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(),
}))

function OpenSettingsButtons() {
    const { openSettings } = useAppSettings()
    return (
        <>
            <button type="button" onClick={() => openSettings('keyboard')}>
                Open keyboard settings
            </button>
            <button type="button" onClick={() => openSettings('editor')}>
                Open editor settings
            </button>
            <button type="button" onClick={() => openSettings()}>
                Open settings
            </button>
        </>
    )
}

function renderDialog() {
    return render(
        <SettingsProvider>
            <OpenSettingsButtons />
            <SettingsDialog />
        </SettingsProvider>
    )
}

describe('SettingsDialog sections', () => {
    let store: Map<string, string>

    beforeEach(() => {
        store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('names the open section in a heading and on the scrolling region', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))

        expect(await screen.findByRole('heading', { level: 3, name: 'Keyboard' })).toBeInTheDocument()
        const region = screen.getByRole('region', { name: 'Keyboard' })
        expect(screen.getByRole('button', { name: 'Keyboard' })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByRole('button', { name: 'Keyboard' })).toHaveAttribute('aria-controls', region.id)
    })

    it('opens each section at the top instead of where the last one was scrolled to', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))

        const keyboard = await screen.findByRole('region', { name: 'Keyboard' })
        keyboard.scrollTop = 400

        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

        const advanced = screen.getByRole('region', { name: 'Advanced' })
        expect(advanced).not.toBe(keyboard)
        expect(advanced.scrollTop).toBe(0)
    })

    it('saves a number typed into a field when Esc closes Settings straight away', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        const fontSize = (await screen.findByRole('textbox', { name: 'Font size' })) as HTMLInputElement
        act(() => fontSize.focus())
        fireEvent.change(fontSize, { target: { value: '1' } })
        fireEvent.change(fontSize, { target: { value: '16' } })
        fireEvent.keyDown(fontSize, { key: 'Escape' })

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        const saved = JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { editor?: { fontSize?: number } }
        expect(saved.editor?.fontSize).toBe(16)
    })

    it('asks for a wrap column only when Word wrap is At column', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))
        await screen.findByRole('textbox', { name: 'Font size' })
        expect(screen.queryByRole('textbox', { name: 'Wrap column' })).not.toBeInTheDocument()
    })

    it('hides the status bar from the Editor section, and remembers that', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        const statusBar = await screen.findByRole('switch', { name: 'Status bar' })
        expect(statusBar).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(statusBar)

        expect(statusBar).toHaveAttribute('aria-checked', 'false')
        const saved = JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { statusBar?: { visible?: boolean } }
        expect(saved.statusBar?.visible).toBe(false)
    })

    it('shows the saved wrap column when Word wrap is At column', async () => {
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ editor: { wordWrap: 'wordWrapColumn', wordWrapColumn: 100 } }))
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        const column = (await screen.findByRole('textbox', { name: 'Wrap column' })) as HTMLInputElement
        expect(column.value).toBe('100')
    })

    it('says that changes save automatically', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

        expect(await screen.findByRole('dialog')).toHaveAccessibleDescription('Changes save automatically.')
    })

    it('says how wide the editor is and what the default is, and resets it', async () => {
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ layout: { editorWidth: 640 } }))
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        expect(await screen.findByText(/^Set to 640 px \(default 400 px\)\./)).toBeInTheDocument()
        const reset = screen.getByRole('button', { name: 'Reset to default' })
        reset.focus()
        fireEvent.click(reset)

        expect(screen.getByText(/^Set to 400 px \(default 400 px\)\./)).toBeInTheDocument()
        // Still usable, so keyboard focus isn't lost when it's pressed.
        expect(reset).toBeEnabled()
        expect(reset).toHaveFocus()
    })
})

describe('SettingsDialog search', () => {
    beforeEach(() => {
        const store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    async function search(text: string) {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
        const box = await screen.findByRole('searchbox', { name: 'Search settings' })
        fireEvent.change(box, { target: { value: text } })
        return box
    }

    function results() {
        return screen.getByRole('region', { name: 'Search results' })
    }

    it('shows matching settings from every section, with the section they are in', async () => {
        await search('font')

        expect(within(results()).getByRole('button', { name: /Font size/ })).toHaveTextContent('Editor')
        expect(within(results()).getByRole('button', { name: /Heading font/ })).toHaveTextContent('Document export › Text')
        expect(screen.getByRole('status')).toHaveTextContent(/^\d+ settings found$/)
        // No section is showing, so none is marked as the current one.
        expect(screen.getByRole('button', { name: 'General' })).not.toHaveAttribute('aria-current')
    })

    it('says so when nothing matches', async () => {
        await search('xyzzy')

        expect(screen.getByRole('status')).toHaveTextContent('No settings match "xyzzy".')
        expect(results()).toHaveTextContent('No settings match "xyzzy".')
    })

    it('opens the section of a result and puts focus on that setting', async () => {
        const box = await search('minimap')
        expect(screen.getByRole('status')).toHaveTextContent('1 setting found')

        fireEvent.click(within(results()).getByRole('button', { name: /Minimap/ }))

        expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'Minimap' })).toHaveFocus()
        expect(box).toHaveValue('')
    })

    it('goes to the switch that turns on a setting that is off, in the right group when a label is used twice', async () => {
        await search('footer background')

        fireEvent.click(within(results()).getByRole('button', { name: /Background colour/ }))

        // Header and Footer both have a Background colour, and both are off until switched on.
        const footer = screen.getByRole('group', { name: 'Footer' })
        expect(within(footer).getByLabelText('Background colour')).toBeDisabled()
        expect(within(footer).getByRole('switch', { name: 'Show footer' })).toHaveFocus()
    })

    it('puts focus on a theme, though only the chosen theme is a tab stop', async () => {
        await search('nord light')

        fireEvent.click(within(results()).getByRole('button', { name: /Nord Light/ }))

        expect(screen.getByRole('radio', { name: 'Nord Light' })).toHaveFocus()
    })

    it('goes to the switch that turns on a setting that is off', async () => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ autosave: { enabled: false } }))
        await search('autosave delay')

        fireEvent.click(within(results()).getByRole('button', { name: /Autosave delay/ }))

        expect(screen.getByRole('textbox', { name: 'Autosave delay (ms)' })).toBeDisabled()
        expect(screen.getByRole('switch', { name: 'Autosave' })).toHaveFocus()
    })

    it('keeps its status line in place before the first key, so screen readers read the first count', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
        const box = await screen.findByRole('searchbox', { name: 'Search settings' })
        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('')

        fireEvent.change(box, { target: { value: 'minimap' } })
        expect(screen.getByRole('status')).toBe(status)
        expect(status).toHaveTextContent('1 setting found')

        fireEvent.change(box, { target: { value: '' } })
        expect(status).toHaveTextContent('')
    })

    it('finds the status bar switch', async () => {
        await search('status bar')

        fireEvent.click(within(results()).getByRole('button', { name: /Status bar/ }))

        expect(screen.getByRole('switch', { name: 'Status bar' })).toHaveFocus()
    })

    it('puts focus on the editor width reset button, even when the width is already the default', async () => {
        await search('editor width')

        fireEvent.click(within(results()).getByRole('button', { name: /Editor width/ }))

        expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveFocus()
    })

    it('moves between the search box and the results with the arrow keys', async () => {
        const box = await search('margin')
        const buttons = within(results()).getAllByRole('button')
        expect(buttons.length).toBeGreaterThan(2)

        fireEvent.keyDown(box, { key: 'ArrowDown' })
        expect(buttons[0]).toHaveFocus()
        fireEvent.keyDown(buttons[0], { key: 'ArrowDown' })
        expect(buttons[1]).toHaveFocus()
        fireEvent.keyDown(buttons[1], { key: 'ArrowUp' })
        expect(buttons[0]).toHaveFocus()
        fireEvent.keyDown(buttons[0], { key: 'ArrowUp' })
        expect(box).toHaveFocus()

        // Down on the last result stays there, and other keys are left alone.
        const last = buttons[buttons.length - 1]
        last.focus()
        fireEvent.keyDown(last, { key: 'ArrowDown' })
        expect(last).toHaveFocus()
        fireEvent.keyDown(last, { key: 'Home' })
        expect(last).toHaveFocus()
    })

    it('leaves Down arrow alone in the search box when nothing matches', async () => {
        const box = await search('xyzzy')
        box.focus()

        fireEvent.keyDown(box, { key: 'ArrowDown' })

        expect(box).toHaveFocus()
    })

    it('goes to the first result on Enter', async () => {
        const box = await search('tab size')

        fireEvent.keyDown(box, { key: 'Enter' })

        expect(screen.getByRole('textbox', { name: 'Tab size' })).toHaveFocus()
    })

    it('clears the search on Esc before a second Esc closes Settings', async () => {
        const box = await search('minimap')

        fireEvent.keyDown(box, { key: 'Escape' })
        expect(box).toHaveValue('')
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument()

        fireEvent.keyDown(box, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('reopens on the last section, not the last search', async () => {
        await search('minimap')

        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

        expect(await screen.findByRole('searchbox', { name: 'Search settings' })).toHaveValue('')
        expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument()
    })

    it('clears the search when a section is picked', async () => {
        const box = await search('minimap')

        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

        expect(box).toHaveValue('')
        expect(screen.getByRole('region', { name: 'Advanced' })).toBeInTheDocument()
    })

    it('can find every setting it lists in that setting’s section', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const entries = settingsSearchEntries({ desktop: true })
        const sections = [...new Set(entries.map((entry) => entry.section))]
        expect(sections).toEqual(SETTINGS_SECTIONS)

        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
        await screen.findByRole('dialog')
        for (const section of sections) {
            const name = getSettingsSectionLabel(section)
            fireEvent.click(screen.getByRole('button', { name }))
            const panel = screen.getByRole('region', { name })
            const missing = entries.filter((entry) => entry.section === section && !findSetting(panel, entry)).map((entry) => entry.label)
            expect(missing, section).toEqual([])
        }

        // And it does notice a setting that isn't there.
        const panel = screen.getByRole('region', { name: 'Advanced' })
        expect(findSetting(panel, { section: 'advanced', label: 'Not a setting' })).toBeNull()
        expect(findSetting(panel, { section: 'advanced', group: 'Not a group', label: 'Recent folders limit' })).toBeNull()
    })

    it('lists every labelled setting each section shows, so a new setting can’t be left out of search', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        // Shows Wrap column, which only appears with this choice.
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ editor: { wordWrap: 'wordWrapColumn' } }))
        const entries = settingsSearchEntries({ desktop: true })

        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
        await screen.findByRole('dialog')
        for (const section of SETTINGS_SECTIONS) {
            const name = getSettingsSectionLabel(section)
            fireEvent.click(screen.getByRole('button', { name }))
            const panel = screen.getByRole('region', { name })
            const missing = Array.from(panel.querySelectorAll('[data-slot="field-label"]'))
                .map((label) => ({ label: label.textContent?.trim() ?? '', group: groupOf(label) }))
                .filter(({ label }) => !ONLY_SHOWN_SOMETIMES.has(label))
                .filter(({ label, group }) => !entries.some((entry) => entry.section === section && entry.label === label && entry.group === group))
            expect(missing, section).toEqual([])
        }
    })
})

/** Rows that only show after another setting's choice. Search finds them through that setting. */
const ONLY_SHOWN_SOMETIMES = new Set(['Wrap column', 'Custom text', 'Page width (mm)', 'Page height (mm)'])

/** The title of the group a setting's label sits in, the way findSetting looks for it. */
function groupOf(label: Element): string | undefined {
    for (let group = label.closest('fieldset, [role="group"]'); group; group = group.parentElement?.closest('fieldset, [role="group"]') ?? null) {
        const title = Array.from(group.children).find((child) => child.matches('[data-slot="fieldset-legend"], h4'))
        if (title) return title.textContent?.trim()
    }
    return undefined
}

describe('SettingsDialog when a section fails to draw', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(notifyError).mockClear()
    })

    afterEach(() => {
        advanced.broken = false
        pdfExport.broken = false
        nav.brokenLabelFor = null
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('shows a notice in its place, and the other sections and Restore defaults still work', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))
        await screen.findByRole('region', { name: 'Keyboard' })

        advanced.broken = true
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

        const region = screen.getByRole('region', { name: 'Advanced' })
        expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't show this section")
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeEnabled()
        expect(notifyError).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Keyboard' }))
        expect(screen.getByRole('region', { name: 'Keyboard' })).toBeInTheDocument()

        // Picking it again tries afresh, once what broke it is gone.
        advanced.broken = false
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
        expect(within(screen.getByRole('region', { name: 'Advanced' })).queryByRole('alert')).toBeNull()
        expect(screen.getByText('Recent folders limit')).toBeInTheDocument()
    })

    it('tries the section again after Restore defaults, without switching sections', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))
        await screen.findByRole('region', { name: 'Keyboard' })

        advanced.broken = true
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
        expect(within(screen.getByRole('region', { name: 'Advanced' })).getByRole('alert')).toHaveTextContent('Restore defaults can put')

        // What broke it was a saved setting, which Restore defaults puts back.
        advanced.broken = false
        fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }))
        const confirm = await screen.findByRole('alertdialog')
        expect(confirm).toHaveTextContent('Your export profiles and the words you added to the dictionary are kept.')
        fireEvent.click(within(confirm).getByRole('button', { name: 'Restore defaults' }))

        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(within(screen.getByRole('region', { name: 'Advanced' })).queryByRole('alert')).toBeNull()
        expect(screen.getByText('Recent folders limit')).toBeInTheDocument()
    })

    it('puts focus on the section when search leads to a setting in a section that failed to draw', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))
        await screen.findByRole('region', { name: 'Keyboard' })

        advanced.broken = true
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'recent folders' } })
        fireEvent.click(within(screen.getByRole('region', { name: 'Search results' })).getByRole('button', { name: /Recent folders limit/ }))

        const region = screen.getByRole('region', { name: 'Advanced' })
        expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't show this section")
        expect(region).toHaveFocus()
    })

    it("doesn't offer Restore defaults as the fix for the Document export section, which it doesn't reset", async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))
        await screen.findByRole('region', { name: 'Keyboard' })

        pdfExport.broken = true
        fireEvent.click(screen.getByRole('button', { name: 'Document export' }))

        const notice = within(screen.getByRole('region', { name: 'Document export' })).getByRole('alert')
        expect(notice).toHaveTextContent("Restore defaults keeps your export profiles, so it won't fix this one.")
        expect(notice).not.toHaveTextContent('can put its settings back')
    })

    it('closes Settings with a notice when the rest of it fails, and reopens on General instead of the same section', async () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open keyboard settings' }))
        await screen.findByRole('region', { name: 'Keyboard' })

        nav.brokenLabelFor = 'advanced'
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(notifyError).toHaveBeenCalledTimes(1)
        expect(vi.mocked(notifyError).mock.calls[0]![0]).toBe("Couldn't show Settings")
        expect(screen.getByRole('button', { name: 'Open keyboard settings' })).toBeInTheDocument()

        // Still broken, but Settings opens without a section on General rather than crashing again.
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
        expect(await screen.findByRole('region', { name: 'General' })).toBeInTheDocument()
        expect(notifyError).toHaveBeenCalledTimes(1)
    })
})
