import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/components/studio/settings/settings-dialog'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/storage'
import { notifyError } from '@/lib/notify'

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

    it('shows the saved wrap column when Word wrap is At column', async () => {
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ editor: { wordWrap: 'wordWrapColumn', wordWrapColumn: 100 } }))
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }))

        const column = (await screen.findByRole('textbox', { name: 'Wrap column' })) as HTMLInputElement
        expect(column.value).toBe('100')
    })
})

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
