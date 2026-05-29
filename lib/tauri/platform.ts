export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isWindowsTauri(): boolean {
    if (!isTauri()) return false
    if (typeof navigator === 'undefined') return false
    return /windows/i.test(navigator.userAgent)
}
