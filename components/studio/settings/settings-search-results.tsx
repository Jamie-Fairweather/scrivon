'use client'

import { getSettingsSectionLabel } from '@/components/studio/settings/settings-nav'
import type { SettingsSearchEntry } from '@/components/studio/settings/settings-search'

/** Anything a setting is changed with. Some are skipped for focus (a number field's +/- buttons). */
const CONTROL = '[role="switch"], [role="radio"], [role="combobox"], button, input:not([aria-hidden="true"]), textarea, select'

/** How long a setting stays lit up after search jumps to it. */
const FLASH_MS = 1600

function canFocus(element: HTMLElement): boolean {
    if (element.matches(':disabled') || element.closest('fieldset[disabled]')) return false
    // A radio group lets arrow keys move between its radios, so only one is a tab stop, but any can take focus.
    return element.tabIndex >= 0 || element.getAttribute('role') === 'radio'
}

function firstFocusableControl(container: HTMLElement): HTMLElement | undefined {
    return [container, ...container.querySelectorAll<HTMLElement>(CONTROL)].find((element) => element.matches(CONTROL) && canFocus(element))
}

/** The element whose own text is exactly `text`. */
function findText(container: Element, text: string): Element | null {
    return (
        Array.from(container.querySelectorAll('*')).find((element) => element.childElementCount === 0 && element.textContent?.trim() === text) ?? null
    )
}

/**
 * Where a search result's setting is in its section's panel: its row (the label and its control), and
 * the group it was looked for in (the whole panel when it has none). Null when it isn't there.
 */
export function findSetting(panel: HTMLElement, entry: SettingsSearchEntry): { row: HTMLElement; scope: HTMLElement } | null {
    let scope: HTMLElement = panel
    if (entry.group) {
        const title = Array.from(panel.querySelectorAll('[data-slot="fieldset-legend"], h4')).find(
            (element) => element.textContent?.trim() === entry.group
        )
        const group = title?.closest<HTMLElement>('fieldset, [role="group"]')
        if (!group) return null
        scope = group
    }

    const label = findText(scope, entry.label)
    // Up from the label to the first box that also holds a control: that's the setting's row.
    for (let element = label; element && scope.contains(element); element = element.parentElement) {
        if (!(element instanceof HTMLElement) || !(element.matches(CONTROL) || element.querySelector(CONTROL))) continue
        const field = element.closest<HTMLElement>('[data-slot="field"]')
        return { row: field && scope.contains(field) ? field : element, scope }
    }
    return null
}

/** Lights the row up for a moment so the eye finds it (see globals.css). */
function flash(row: HTMLElement) {
    row.removeAttribute('data-settings-search-hit')
    // Read the layout so the light starts again when the same row is found twice in a row.
    void row.offsetWidth
    row.setAttribute('data-settings-search-hit', '')
    setTimeout(() => row.removeAttribute('data-settings-search-hit'), FLASH_MS)
}

/**
 * Scrolls to the setting, lights it up and puts focus on its control. A setting that's switched off
 * gets focus on the first control in its group instead, often the switch that turns it on.
 */
export function revealSetting(panel: HTMLElement, entry: SettingsSearchEntry): void {
    const found = findSetting(panel, entry)
    if (!found) {
        panel.focus()
        return
    }
    const { row, scope } = found
    row.scrollIntoView({ block: 'center' })
    flash(row)
    const control = firstFocusableControl(row)
    if (control) control.focus({ preventScroll: true })
    else firstFocusableControl(scope)?.focus()
}

function whereIs(entry: SettingsSearchEntry): string {
    const section = getSettingsSectionLabel(entry.section)
    return entry.group ? `${section} › ${entry.group}` : section
}

type SettingsSearchResultsProps = {
    query: string
    results: SettingsSearchEntry[]
    onPick: (entry: SettingsSearchEntry) => void
}

/** Settings that match a search, each with the section (and group) it's in. */
export function SettingsSearchResults({ query, results, onPick }: SettingsSearchResultsProps) {
    return (
        <div className="space-y-3">
            <p role="status" className="text-sm text-muted-foreground">
                {results.length === 0
                    ? `No settings match "${query.trim()}".`
                    : `${results.length} ${results.length === 1 ? 'setting' : 'settings'} found`}
            </p>
            {results.length > 0 ? (
                <ul className="grid gap-0.5">
                    {results.map((entry) => (
                        <li key={`${entry.section}:${entry.group ?? ''}:${entry.label}`}>
                            <button
                                type="button"
                                onClick={() => onPick(entry)}
                                className="w-full rounded-md px-2.5 py-1.5 text-left transition-colors outline-none hover:bg-accent/60
                                    focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="block text-sm font-medium">{entry.label}</span>
                                <span className="block text-xs text-muted-foreground">{whereIs(entry)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}
