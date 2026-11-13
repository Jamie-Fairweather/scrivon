import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

/**
 * Writes to the app's log file (scrivon.log in the logs folder, set up in src-tauri/src/diagnostics.rs),
 * so a problem can be reported with the log attached. Only what failed and why goes in: never a
 * document's text.
 */

/** tauri-plugin-log's levels (LogLevel in its Rust code). */
const LEVEL = { warn: 4, error: 5 } as const

/** Longest line kept; the rest is cut off. */
const MAX_LINE_LENGTH = 300
/** How many places from an error's stack are kept. */
const MAX_STACK_FRAMES = 10

/**
 * One short line. Only the first line is kept and quoted text is left out: parse errors quote or show
 * the document text they couldn't read (beautiful-mermaid: Invalid mermaid header: "<first line>").
 */
function safeLine(text: string): string {
    const line = (text.trim().split(/\r?\n/, 1)[0] ?? '').replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, '"…"')
    return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…` : line
}

function messageOf(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message
    return 'Unknown error'
}

/**
 * Where an error happened: the stack's "at …" lines. Chromium (WebView2) puts the message first, which
 * is dropped before looking for them, so a document line in it that starts with "at" isn't taken for one.
 */
function stackFrames(err: unknown): string[] {
    if (!(err instanceof Error) || !err.stack) return []
    const head = err.message ? `${err.name}: ${err.message}` : err.name
    const frames = err.stack.startsWith(head) ? err.stack.slice(head.length) : err.stack
    return frames
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at '))
        .slice(0, MAX_STACK_FRAMES)
        .map((line) => `    ${safeLine(line)}`)
}

/** An error as the log shows it: its name and message on one line, then where it happened. */
export function describeError(err: unknown): string {
    return [safeLine(messageOf(err)), ...stackFrames(err)].join('\n')
}

function write(level: keyof typeof LEVEL, title: string, err: unknown): void {
    if (!isTauri()) return
    const message = err === undefined ? safeLine(title) : `${safeLine(title)}: ${describeError(err)}`
    try {
        // The plugin's own command, without its JS package: that would name the caller's place in the
        // bundled code, which is always this file.
        void invoke('plugin:log|log', { level: LEVEL[level], message }).catch(() => {})
    } catch {
        // Logging must never cause another error.
    }
}

/** Logs what failed (`title`) and why (`err`, if given). */
export function logError(title: string, err?: unknown): void {
    write('error', title, err)
}

export function logWarning(title: string, detail?: unknown): void {
    write('warn', title, detail)
}
