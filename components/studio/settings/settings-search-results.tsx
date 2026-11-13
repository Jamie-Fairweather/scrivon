'use client'

import type { KeyboardEvent } from 'react'
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
 * For a setting that's switched off: the switch that most likely turns it on. In a titled group that's
 * the group's first switch (such as Show footer); otherwise the nearest switch above it. Failing that,
 * the group's first control.
 */
function controlForOffSetting(row: HTMLElement, scope: HTMLElement, inGroup: boolean): HTMLElement | undefined {
    const switchesAbove = Array.from(scope.querySelectorAll<HTMLElement>('[role="switch"]')).filter(
        (control) => canFocus(control) && Boolean(control.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
    return (inGroup ? switchesAbove[0] : switchesAbove.at(-1)) ?? firstFocusableControl(scope)
}

/**
 * Scrolls to the setting, lights it up and puts focus on its control. A setting that's switched off
 * gets focus on the switch above it instead, which most likely turns it on.
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
    else controlForOffSetting(row, scope, Boolean(entry.group))?.focus()
}

/** What a search found, in words: shown above the results and read out by screen readers. */
export function describeSearchResults(query: string, results: SettingsSearchEntry[]): string {
    if (results.length === 0) return `No settings match "${query.trim()}".`
    return `${results.length} ${results.length === 1 ? 'setting' : 'settings'} found`
}

function whereIs(entry: SettingsSearchEntry): string {
    const section = getSettingsSectionLabel(entry.section)
    return entry.group ? `${section} › ${entry.group}` : section
}

type SettingsSearchResultsProps = {
    query: string
    results: SettingsSearchEntry[]
    onPick: (entry: SettingsSearchEntry) => void
    /** Up arrow on the first result, to go back to the search box. */
    onUpFromFirst: () => void
}

/**
 * Settings that match a search, each with the section (and group) it's in. Up and Down arrows move
 * through them.
 */
export function SettingsSearchResults({ query, results, onPick, onUpFromFirst }: SettingsSearchResultsProps) {
    const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
        const index = buttons.findIndex((button) => button === event.target)
        if (index < 0) return
        // So the arrow doesn't scroll the list as well.
        event.preventDefault()
        const next = index + (event.key === 'ArrowDown' ? 1 : -1)
        if (next < 0) onUpFromFirst()
        else buttons[Math.min(next, buttons.length - 1)].focus()
    }

    return (
        <div className="space-y-3">
            {/* The dialog's own status line reads this out; this one is for the eye. */}
            <p className="text-sm text-muted-foreground">{describeSearchResults(query, results)}</p>
            {results.length > 0 ? (
                <ul className="grid gap-0.5" onKeyDown={onKeyDown}>
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
