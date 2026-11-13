import { act, render, screen } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { APP_VERSION } from '@/lib/legal/app-version'
import { notifyError, notifySuccess } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/dialogs/open-source-licenses-dialog', () => ({
    OpenSourceLicensesDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Licences" /> : null),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }))

let shown: ReturnType<typeof useCommands> = []
function CommandsProbe() {
    const commands = useCommands()
    useEffect(() => {
        shown = commands
    }, [commands])
    return null
}

function renderHelp() {
    render(
        <CommandRegistryProvider>
            <HelpCommands />
            <CommandsProbe />
        </CommandRegistryProvider>
    )
}

async function run(id: string) {
    await act(async () => {
        await shown.find((c) => c.id === id)!.run()
    })
}

const writeText = vi.fn<(text: string) => Promise<void>>()

/** Plays the desktop app: system_info answers, and open_logs_folder does `openLogs`. */
function onDesktop(openLogs: () => Promise<void> = async () => {}) {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'system_info') return { os: 'Windows 11 (10.0.26200)', arch: 'x86_64', webview: '131.0.2903.70' }
        if (command === 'open_logs_folder') return openLogs()
        return undefined
    })
}

beforeEach(() => {
    shown = []
    vi.mocked(useAppSettings).mockReturnValue({ settings: createDefaultSettings(false) } as unknown as ReturnType<typeof useAppSettings>)
    writeText.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'TestBrowser/1.0', clipboard: { writeText } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(invoke).mockReset()
    vi.mocked(openUrl).mockReset()
    vi.mocked(notifyError).mockReset()
    vi.mocked(notifySuccess).mockReset()
})

describe('HelpCommands', () => {
    it('adds the Help commands', () => {
        renderHelp()
        expect(shown.map((c) => c.label)).toEqual(['Report an Issue', 'Copy Diagnostic Info', 'Open Logs Folder', 'About Scrivon…', 'Licences…'])
    })

    it.each([
        ['about', /About/],
        ['licences', /Licences/],
    ])('opens its dialog from the %s command', (id, name) => {
        renderHelp()

        act(() => void shown.find((c) => c.id === id)!.run())
        expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
    })

    it('can be found by typing "licenses" too', () => {
        renderHelp()
        expect(shown.find((c) => c.id === 'licences')?.keywords).toContain('licenses')
    })
})

describe('Copy Diagnostic Info', () => {
    it('copies the app, Windows and WebView2 versions and a summary of the settings', async () => {
        onDesktop()
        renderHelp()

        await run('copy-diagnostic-info')

        const text = writeText.mock.calls[0]![0]
        expect(text).toContain(`Scrivon ${APP_VERSION}`)
        expect(text).toContain('Windows 11 (10.0.26200), x86_64')
        expect(text).toContain('WebView2 131.0.2903.70')
        expect(text).toContain('- Autosave: on')
        expect(notifySuccess).toHaveBeenCalledWith('Diagnostic info copied', expect.anything())
    })

    it('names the browser outside the desktop app', async () => {
        renderHelp()

        await run('copy-diagnostic-info')

        expect(writeText.mock.calls[0]![0]).toContain('Browser: TestBrowser/1.0')
        expect(invoke).not.toHaveBeenCalledWith('system_info')
    })

    it("still copies what it knows when the app can't say which Windows it runs on", async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockRejectedValue(new Error('command system_info not found'))
        renderHelp()

        await run('copy-diagnostic-info')

        expect(writeText.mock.calls[0]![0]).toContain(`Scrivon ${APP_VERSION}`)
    })

    it('says so when the clipboard refuses', async () => {
        writeText.mockRejectedValue(new Error('Clipboard blocked'))
        renderHelp()

        await run('copy-diagnostic-info')

        expect(notifyError).toHaveBeenCalledWith("Couldn't copy the diagnostic info", new Error('Clipboard blocked'))
        expect(notifySuccess).not.toHaveBeenCalled()
    })
})

describe('Open Logs Folder', () => {
    it('opens the folder with the log files', async () => {
        onDesktop()
        renderHelp()

        await run('open-logs-folder')

        expect(invoke).toHaveBeenCalledWith('open_logs_folder')
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('says so when the folder cannot be opened', async () => {
        onDesktop(async () => {
            throw 'Access is denied. (os error 5)'
        })
        renderHelp()

        await run('open-logs-folder')

        expect(notifyError).toHaveBeenCalledWith("Couldn't open the logs folder", 'Access is denied. (os error 5)')
    })

    it('is off outside the desktop app, which has no log files', () => {
        renderHelp()

        const command = shown.find((c) => c.id === 'open-logs-folder')!
        expect(command.disabled).toBe(true)
        expect(command.disabledReason).toBe('Desktop only')
    })
})

describe('Report an Issue', () => {
    it('opens a new GitHub issue in the browser, with the diagnostic info filled in', async () => {
        onDesktop()
        renderHelp()

        await run('report-issue')

        const url = new URL(vi.mocked(openUrl).mock.calls[0]![0] as string)
        expect(url.href.startsWith('https://github.com/Jamie-Fairweather/scrivon/issues/new?')).toBe(true)
        expect(url.searchParams.get('body')).toContain('WebView2 131.0.2903.70')
    })

    it('opens it in a new tab outside the desktop app', async () => {
        const open = vi.fn()
        vi.stubGlobal('open', open)
        renderHelp()

        await run('report-issue')

        expect(open).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/github\.com\/Jamie-Fairweather\/scrivon\/issues\/new\?/),
            '_blank',
            'noopener,noreferrer'
        )
        expect(openUrl).not.toHaveBeenCalled()
    })

    it('says so when the browser cannot be opened', async () => {
        onDesktop()
        vi.mocked(openUrl).mockRejectedValue(new Error('No browser'))
        renderHelp()

        await run('report-issue')

        expect(notifyError).toHaveBeenCalledWith("Couldn't open the issue page", new Error('No browser'))
    })
})
