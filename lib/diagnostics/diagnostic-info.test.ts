import { describe, expect, it } from 'vitest'
import { formatDiagnosticInfo, newIssueUrl } from '@/lib/diagnostics/diagnostic-info'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings } from '@/lib/settings/types'

function settings(change: (settings: AppSettings) => void = () => {}): AppSettings {
    const value = createDefaultSettings(false)
    value.spellcheck = { enabled: true, language: 'en-GB', words: ['Scrivon', 'my-private-word'] }
    change(value)
    return value
}

const system = { appVersion: '1.5.0', os: 'Windows 11 (10.0.26200)', arch: 'x86_64', webview: '131.0.2903.70' }

describe('formatDiagnosticInfo', () => {
    it('gives the app, Windows and WebView2 versions, then a summary of the settings', () => {
        const text = formatDiagnosticInfo({ system, settings: settings() })

        expect(text).toBe(
            [
                'Scrivon 1.5.0',
                'Windows 11 (10.0.26200), x86_64',
                'WebView2 131.0.2903.70',
                '',
                'Settings',
                '- Theme: follows Windows (scrivon-light / scrivon-dark)',
                '- App zoom: 100%, preview text 14 px',
                '- Autosave: on, after 400 ms',
                '- Editor: 13 px, tab size 2, word wrap on, line numbers on, minimap off',
                '- Spelling: on, en-GB',
                '- Check for updates on launch: on',
                '- Reopen last folder: on',
                '- Panels open: explorer, editor, preview',
                '- Changed shortcuts: 0',
            ].join('\n')
        )
    })

    it('names a fixed theme, and says which settings are off', () => {
        const text = formatDiagnosticInfo({
            system,
            settings: settings((s) => {
                s.theme = { ...s.theme, id: 'scrivon-dark' }
                s.autosave.enabled = false
                s.editor.wordWrap = 'wordWrapColumn'
                s.editor.minimap = true
                s.spellcheck.enabled = false
                s.updates.checkOnLaunch = false
            }),
        })

        expect(text).toContain('- Theme: scrivon-dark')
        expect(text).toContain('- Autosave: off')
        expect(text).toContain('word wrap at column 80')
        expect(text).toContain('minimap on')
        expect(text).toContain('- Spelling: off')
        expect(text).toContain('- Check for updates on launch: off')
    })

    it('gives the app zoom and preview text size the user picked', () => {
        const text = formatDiagnosticInfo({ system, settings: settings((s) => (s.appearance = { zoom: 1.25, previewFontSize: 18 })) })

        expect(text).toContain('- App zoom: 125%, preview text 18 px')
    })

    it('says when the preview is hidden', () => {
        const text = formatDiagnosticInfo({ system, settings: settings((s) => (s.layout = { ...s.layout, previewOpen: false, outlineOpen: true })) })

        expect(text).toContain('- Panels open: explorer, editor, outline')
    })

    it('lists the preview in Preview Only, where the editor is hidden', () => {
        const previewOnly = settings((s) => (s.layout = { ...s.layout, explorerOpen: false, editorOpen: false, outlineOpen: false }))

        expect(formatDiagnosticInfo({ system, settings: previewOnly })).toContain('- Panels open: preview')
        // The preview shows whenever the editor is hidden, even if its own setting is off.
        previewOnly.layout.previewOpen = false
        expect(formatDiagnosticInfo({ system, settings: previewOnly })).toContain('- Panels open: preview')
    })

    it('counts the shortcuts the user changed', () => {
        const text = formatDiagnosticInfo({
            system,
            settings: settings((s) => {
                s.keybinds['document.save'] = [{ key: 's', ctrl: true, shift: true }]
                s.keybinds['palette.open'] = []
            }),
        })

        expect(text).toContain('- Changed shortcuts: 2')
    })

    it("names the browser when it isn't the desktop app", () => {
        const text = formatDiagnosticInfo({
            system: { appVersion: '1.5.0', browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0' },
            settings: settings(),
        })

        expect(text.split('\n').slice(0, 3)).toEqual(['Scrivon 1.5.0', 'Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', ''])
    })

    it('says when the WebView2 version is unknown', () => {
        expect(formatDiagnosticInfo({ system: { ...system, webview: null }, settings: settings() })).toContain('WebView2 unknown version')
    })

    it("leaves out the user's own words and folders", () => {
        const text = formatDiagnosticInfo({ system, settings: settings() })

        expect(text).not.toContain('my-private-word')
        expect(text).not.toMatch(/[A-Z]:\\/)
    })
})

describe('newIssueUrl', () => {
    it('opens a new GitHub issue with the diagnostic info filled in', () => {
        const url = new URL(newIssueUrl('Scrivon 1.5.0\nWebView2 131'))

        expect(`${url.origin}${url.pathname}`).toBe('https://github.com/Jamie-Fairweather/scrivon/issues/new')
        const body = url.searchParams.get('body')!
        expect(body).toContain('What happened?')
        expect(body).toContain('```\nScrivon 1.5.0\nWebView2 131\n```')
    })

    it('asks for the log, with a warning that it can name files and folders', () => {
        const body = new URL(newIssueUrl('Scrivon 1.5.0')).searchParams.get('body')!

        expect(body).toContain('attach scrivon.log (Help > Open Logs Folder)')
        expect(body).toContain('It can show file and folder names, so check it first.')
    })
})
