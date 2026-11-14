import { invoke } from '@tauri-apps/api/core'
import { APP_NAME, APP_REPO_URL } from '@/lib/app-branding'
import { APP_VERSION } from '@/lib/legal/app-version'
import { chordListsEqual, isMacPlatform } from '@/lib/settings/chord-utils'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { FOLLOW_SYSTEM, type AppSettings, type KeybindActionId } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'
import { isPreviewShown } from '@/lib/workspace/types'
import { formatZoomPercent } from '@/lib/zoom/app-zoom'

/** What the desktop app says about the computer (SystemInfo in src-tauri/src/diagnostics.rs). */
type DesktopInfo = { os: string; arch: string; webview: string | null }

export type SystemInfo = { appVersion: string } & (DesktopInfo | { browser: string })

/** The app's version and the Windows and WebView2 versions, or the browser outside the desktop app. */
export async function getSystemInfo(): Promise<SystemInfo> {
    const browser = { appVersion: APP_VERSION, browser: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent }
    if (!isTauri()) return browser
    try {
        return { appVersion: APP_VERSION, ...(await invoke<DesktopInfo>('system_info')) }
    } catch (err) {
        console.warn("Couldn't read the system info", err)
        return browser
    }
}

const onOff = (on: boolean) => (on ? 'on' : 'off')

function changedShortcuts(settings: AppSettings): number {
    const defaults = createDefaultKeybinds(isMacPlatform())
    return (Object.keys(defaults) as KeybindActionId[]).filter((id) => !chordListsEqual(settings.keybinds[id] ?? [], defaults[id])).length
}

/**
 * The settings that change how the app behaves, for a bug report. Nothing personal: no folders, file
 * names, dictionary words or PDF header text.
 */
function settingsSummary(settings: AppSettings): string[] {
    const { theme, appearance, autosave, editor, spellcheck, layout } = settings
    const wordWrap = editor.wordWrap === 'wordWrapColumn' ? `at column ${editor.wordWrapColumn}` : editor.wordWrap
    const panels = [
        layout.explorerOpen && 'explorer',
        layout.editorOpen && 'editor',
        isPreviewShown(layout) && 'preview',
        layout.outlineOpen && 'outline',
    ].filter(Boolean)
    return [
        `Theme: ${theme.id === FOLLOW_SYSTEM ? `follows Windows (${theme.light} / ${theme.dark})` : theme.id}`,
        `App zoom: ${formatZoomPercent(appearance.zoom)}, preview text ${appearance.previewFontSize} px`,
        `Autosave: ${autosave.enabled ? `on, after ${autosave.delayMs} ms` : 'off'}`,
        `Editor: ${editor.fontSize} px, tab size ${editor.tabSize}, word wrap ${wordWrap}, line numbers ${editor.lineNumbers}, minimap ${onOff(editor.minimap)}`,
        `Spelling: ${spellcheck.enabled ? `on, ${spellcheck.language}` : 'off'}`,
        `Check for updates on launch: ${onOff(settings.updates.checkOnLaunch)}`,
        `Reopen last folder: ${onOff(settings.workspace.reopenLastFolder)}`,
        `Panels open: ${panels.join(', ') || 'none'}`,
        `Changed shortcuts: ${changedShortcuts(settings)}`,
    ]
}

/** Help > Copy Diagnostic Info: what to put in a bug report. */
export function formatDiagnosticInfo({ system, settings }: { system: SystemInfo; settings: AppSettings }): string {
    const where =
        'browser' in system ? [`Browser: ${system.browser}`] : [`${system.os}, ${system.arch}`, `WebView2 ${system.webview ?? 'unknown version'}`]
    return [`${APP_NAME} ${system.appVersion}`, ...where, '', 'Settings', ...settingsSummary(settings).map((line) => `- ${line}`)].join('\n')
}

/** Issues are public, and the log can name the user's files and folders (paths in error messages). */
const LOG_HINT = 'If you can, attach scrivon.log (Help > Open Logs Folder). It can show file and folder names, so check it first.'

/** A new GitHub issue, with the diagnostic info already in it. */
export function newIssueUrl(diagnosticInfo: string): string {
    const body = [
        '**What happened?**',
        '',
        '',
        '**Steps to reproduce**',
        '',
        '',
        '**Diagnostic info**',
        '```',
        diagnosticInfo,
        '```',
        '',
        LOG_HINT,
    ].join('\n')
    return `${APP_REPO_URL}/issues/new?body=${encodeURIComponent(body)}`
}
