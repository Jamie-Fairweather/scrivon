import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfExportSettings } from '@/components/studio/settings/sections/pdf-export-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { getActivePdfExportProfile, updatePdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
}))

const PNG = 'data:image/png;base64,iVBORw0KGgo='

let current: ReturnType<typeof useAppSettings>

function Settings() {
    const settings = useAppSettings()
    useEffect(() => {
        current = settings
    })
    return null
}

function renderSection() {
    render(
        <SettingsProvider>
            <PdfExportSettings />
            <Settings />
        </SettingsProvider>
    )
}

const activeProfile = () => getActivePdfExportProfile(current.settings.pdfExport)

function profileFile(name: string, logo = PNG) {
    const profile = createDefaultPdfExportProfile({ name })
    profile.page.size = 'letter'
    profile.brand.logoPath = logo
    return JSON.stringify({ scrivon: 'export-profile', version: 1, profile })
}

describe('export profile Export and Import', () => {
    beforeEach(() => {
        window.localStorage.clear()
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockReset()
        vi.mocked(invoke).mockImplementation(async (command: string) => {
            if (command === 'list_system_fonts') return []
            if (command === 'read_export_image') return PNG
            if (command === 'save_profile_image') return 'C:/AppData/profile-images/1.png'
            return undefined
        })
        vi.mocked(open).mockReset().mockResolvedValue(null)
        vi.mocked(save).mockReset().mockResolvedValue(null)
        vi.mocked(writeTextFile).mockReset()
        vi.mocked(readFile).mockReset()
        vi.mocked(notifyError).mockReset()
        vi.mocked(notifySuccess).mockReset()
        vi.mocked(notifyWarning).mockReset()
    })

    it('saves the profile with its images to the chosen file', async () => {
        vi.mocked(save).mockResolvedValue('C:/Share/Default.json')
        renderSection()
        act(() =>
            current.updateSettings((settings) => ({
                ...settings,
                pdfExport: updatePdfExportProfile(settings.pdfExport, settings.pdfExport.activeProfileId, (profile) => ({
                    ...profile,
                    brand: { ...profile.brand, logoPath: 'C:/brand/cover.png' },
                })),
            }))
        )

        fireEvent.click(screen.getByRole('button', { name: 'Export profile…' }))

        await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
        const [path, text] = vi.mocked(writeTextFile).mock.calls[0]!
        expect(path).toBe('C:/Share/Default.json')
        expect(JSON.parse(text as string)).toMatchObject({ scrivon: 'export-profile', profile: { name: 'Default', brand: { logoPath: PNG } } })
        expect(vi.mocked(save).mock.calls[0]![0]).toMatchObject({ defaultPath: 'Default.json' })
        expect(invoke).toHaveBeenCalledWith('read_export_image', { path: 'C:/brand/cover.png' })
        expect(notifySuccess).toHaveBeenCalledWith('Profile exported', { description: 'Saved as Default.json.' })
    })

    it('says which images it had to leave out', async () => {
        vi.mocked(save).mockResolvedValue('C:/Share/Default.json')
        vi.mocked(invoke).mockImplementation(async (command: string) => {
            if (command === 'read_export_image') throw 'Choose this image again with Browse.'
            return command === 'list_system_fonts' ? [] : undefined
        })
        renderSection()
        act(() =>
            current.updateSettings((settings) => ({
                ...settings,
                pdfExport: updatePdfExportProfile(settings.pdfExport, settings.pdfExport.activeProfileId, (profile) => ({
                    ...profile,
                    footer: { ...profile.footer, left: { text: '', imagePath: 'C:/gone.png' } },
                })),
            }))
        )

        fireEvent.click(screen.getByRole('button', { name: 'Export profile…' }))

        await waitFor(() =>
            expect(notifyWarning).toHaveBeenCalledWith('Profile exported without some images', {
                description: 'Footer left image: Choose this image again with Browse.',
            })
        )
        expect(writeTextFile).toHaveBeenCalled()
    })

    it('adds a profile from a file under a free name, saves its images and shows it', async () => {
        vi.mocked(open).mockResolvedValue('C:/Share/Default.json')
        vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode(profileFile('Default')))
        renderSection()

        fireEvent.click(screen.getByRole('button', { name: 'Import profile…' }))

        await waitFor(() => expect(current.settings.pdfExport.profiles).toHaveLength(2))
        expect(activeProfile().name).toBe('Default 2')
        expect(activeProfile().page.size).toBe('letter')
        expect(activeProfile().brand.logoPath).toBe('C:/AppData/profile-images/1.png')
        await waitFor(() => expect(screen.getByLabelText('Profile name')).toHaveFocus())
        expect(screen.getByLabelText('Profile name')).toHaveValue('Default 2')
        expect(notifySuccess).toHaveBeenCalledWith('Profile imported', { description: 'Added as "Default 2".' })
    })

    it('says which images it had to leave out of an imported profile', async () => {
        vi.mocked(open).mockResolvedValue('C:/Share/Report.json')
        vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode(profileFile('Report', 'D:/Logos/cover.png')))
        renderSection()

        fireEvent.click(screen.getByRole('button', { name: 'Import profile…' }))

        await waitFor(() =>
            expect(notifyWarning).toHaveBeenCalledWith('Profile imported without some images', {
                description: 'Added as "Report". Cover image: It isn\'t embedded in the file.',
            })
        )
        expect(activeProfile().brand.logoPath).toBe('')
    })

    it('keeps the profiles and says why when the file is not a profile', async () => {
        vi.mocked(open).mockResolvedValue('C:/Share/settings.json')
        vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('{"scrivon": "settings", "settings": {}}'))
        renderSection()

        fireEvent.click(screen.getByRole('button', { name: 'Import profile…' }))

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't import the profile", expect.any(Error)))
        expect(vi.mocked(notifyError).mock.calls[0]![1]).toHaveProperty('message', 'This is a settings file. Import it in Settings, Advanced.')
        expect(current.settings.pdfExport.profiles).toHaveLength(1)
    })

    it('says when the profile could not be saved', async () => {
        vi.mocked(save).mockResolvedValue('E:/Share/Default.json')
        vi.mocked(writeTextFile).mockRejectedValue('The device is not ready. (os error 21)')
        renderSection()

        fireEvent.click(screen.getByRole('button', { name: 'Export profile…' }))

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't export the profile", 'The device is not ready. (os error 21)'))
    })

    it('does nothing when no file is chosen', async () => {
        renderSection()

        fireEvent.click(screen.getByRole('button', { name: 'Export profile…' }))
        fireEvent.click(screen.getByRole('button', { name: 'Import profile…' }))

        await waitFor(() => expect(open).toHaveBeenCalled())
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(current.settings.pdfExport.profiles).toHaveLength(1)
        expect(notifySuccess).not.toHaveBeenCalled()
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('is only offered in the desktop app', () => {
        vi.mocked(isTauri).mockReturnValue(false)
        renderSection()

        expect(screen.queryByRole('button', { name: 'Export profile…' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Import profile…' })).not.toBeInTheDocument()
    })
})
