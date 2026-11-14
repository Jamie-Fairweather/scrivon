import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsBackup } from '@/components/studio/settings/settings-backup'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { createPdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import type { AppSettings } from '@/lib/settings/types'
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

function renderBackup() {
    render(
        <SettingsProvider>
            <SettingsBackup />
            <Settings />
        </SettingsProvider>
    )
}

function fileText(text: string) {
    vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode(text))
}

function settingsFile(settings: AppSettings) {
    return JSON.stringify({ scrivon: 'settings', version: 1, settings })
}

function chooseFileToImport() {
    fireEvent.click(screen.getByRole('button', { name: 'Import settings…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
}

describe('SettingsBackup', () => {
    beforeEach(() => {
        window.localStorage.clear()
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockReset()
        vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
            if (command === 'read_export_image') {
                if ((args as { path: string }).path === 'C:/Brand/cover.png') return PNG
                throw 'Choose this image again with Browse.'
            }
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

    it('saves every setting and export profile to the chosen file', async () => {
        vi.mocked(save).mockResolvedValue('C:/Backups/Scrivon settings.json')
        renderBackup()
        act(() => current.updateSettings((settings) => ({ ...settings, theme: { ...settings.theme, id: 'tokyo-night' } })))

        fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }))

        await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
        const [path, text] = vi.mocked(writeTextFile).mock.calls[0]!
        expect(path).toBe('C:/Backups/Scrivon settings.json')
        expect(JSON.parse(text as string)).toMatchObject({ scrivon: 'settings', settings: { theme: { id: 'tokyo-night' } } })
        expect(vi.mocked(save).mock.calls[0]![0]).toMatchObject({ defaultPath: 'Scrivon settings.json' })
        expect(notifySuccess).toHaveBeenCalledWith('Settings exported', { description: 'Saved as Scrivon settings.json.' })
    })

    it('puts profile images in the file, and says which it had to leave out', async () => {
        vi.mocked(save).mockResolvedValue('C:/Backups/Scrivon settings.json')
        renderBackup()
        act(() =>
            current.updateSettings((settings) => {
                const [profile] = settings.pdfExport.profiles
                const branded = { ...profile!, brand: { ...profile!.brand, logoPath: 'C:/Brand/cover.png' } }
                branded.header = { ...branded.header, left: { ...branded.header.left, imagePath: 'C:/Gone/logo.png' } }
                return { ...settings, pdfExport: { ...settings.pdfExport, profiles: [branded] } }
            })
        )

        fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }))

        await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
        const file = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string) as { settings: AppSettings }
        expect(file.settings.pdfExport.profiles[0]!.brand.logoPath).toBe(PNG)
        expect(file.settings.pdfExport.profiles[0]!.header.left.imagePath).toBe('')
        expect(notifyWarning).toHaveBeenCalledWith('Settings exported without some images', {
            description: 'Header left image in "Default": Choose this image again with Browse.',
        })
        expect(notifySuccess).not.toHaveBeenCalled()
    })

    it('asks first, then replaces every setting with the ones in the file', async () => {
        const imported = createDefaultSettings(false)
        imported.editor.fontSize = 21
        imported.pdfExport = createPdfExportProfile(imported.pdfExport, 'Company report')
        fileText(settingsFile(imported))
        vi.mocked(open).mockResolvedValue('C:/Backups/Scrivon settings.json')
        renderBackup()

        fireEvent.click(screen.getByRole('button', { name: 'Import settings…' }))
        expect(screen.getByRole('alertdialog', { name: 'Import settings?' })).toHaveTextContent('replaced')
        expect(open).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))

        await waitFor(() => expect(current.settings.editor.fontSize).toBe(21))
        expect(current.settings.pdfExport.profiles.map((profile) => profile.name)).toEqual(['Default', 'Company report'])
        expect(readFile).toHaveBeenCalledWith('C:/Backups/Scrivon settings.json')
        expect(notifySuccess).toHaveBeenCalledWith('Settings imported')
    })

    it("saves the file's images on this computer, and says which it had to leave out", async () => {
        const imported = createDefaultSettings(false)
        imported.pdfExport.profiles[0]!.brand.logoPath = PNG
        imported.pdfExport.profiles[0]!.footer.right.imagePath = 'D:/Elsewhere/logo.png'
        fileText(settingsFile(imported))
        vi.mocked(open).mockResolvedValue('C:/Backups/Scrivon settings.json')
        renderBackup()

        chooseFileToImport()

        await waitFor(() => expect(current.settings.pdfExport.profiles[0]!.brand.logoPath).toBe('C:/AppData/profile-images/1.png'))
        expect(current.settings.pdfExport.profiles[0]!.footer.right.imagePath).toBe('')
        expect(notifyWarning).toHaveBeenCalledWith('Settings imported without some images', {
            description: 'Footer right image in "Default": Choose this image again with Browse.',
        })
        expect(notifySuccess).not.toHaveBeenCalled()
    })

    it('imports a settings.json from settings saved before 1.5.0, which has no schemaVersion', async () => {
        fileText(JSON.stringify({ theme: { id: 'nord' }, editor: { fontSize: 16 } }))
        vi.mocked(open).mockResolvedValue('C:/Users/me/AppData/Roaming/com.scrivon.app/settings.json')
        renderBackup()

        chooseFileToImport()

        await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Settings imported'))
        expect(current.settings.theme.id).toBe('nord')
        expect(current.settings.editor.fontSize).toBe(16)
    })

    it('keeps the settings and says why when the file is not a settings file', async () => {
        fileText('{"hello": "world"}')
        vi.mocked(open).mockResolvedValue('C:/Downloads/notes.json')
        renderBackup()
        const before = current.settings

        chooseFileToImport()

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't import settings", expect.any(Error)))
        expect(vi.mocked(notifyError).mock.calls[0]![1]).toHaveProperty('message', "This file isn't a Scrivon settings file.")
        expect(current.settings).toBe(before)
    })

    it('does nothing when no file is chosen', async () => {
        renderBackup()
        const before = current.settings

        fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }))
        chooseFileToImport()

        await waitFor(() => expect(open).toHaveBeenCalled())
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(current.settings).toBe(before)
        expect(notifyError).not.toHaveBeenCalled()
        expect(notifySuccess).not.toHaveBeenCalled()
    })

    it('says when the file could not be saved', async () => {
        vi.mocked(save).mockResolvedValue('E:/Backups/settings.json')
        vi.mocked(writeTextFile).mockRejectedValue('The device is not ready. (os error 21)')
        renderBackup()

        fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }))

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't export settings", 'The device is not ready. (os error 21)'))
    })

    it('is only offered in the desktop app', () => {
        vi.mocked(isTauri).mockReturnValue(false)
        renderBackup()

        expect(screen.queryByRole('button', { name: 'Export settings…' })).not.toBeInTheDocument()
    })
})
