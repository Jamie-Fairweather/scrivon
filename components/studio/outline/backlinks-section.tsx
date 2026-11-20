'use client'

import { memo, useId, useRef, useState, type KeyboardEvent } from 'react'
import { outlineKeyTarget } from '@/components/studio/outline/outline-keys'
import type { BacklinksState } from '@/components/studio/outline/use-backlinks'
import type { Backlink } from '@/lib/workspace/backlinks'

function Note({ children }: { children: string }) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}

const INCOMPLETE = "Scrivon didn't list every file in this folder, so this list may be incomplete."

type BacklinkListProps = { links: readonly Backlink[]; onPick: (link: Backlink) => void }

/** The links as one Tab stop of their own: the arrow keys, Home and End move between them, as in the headings above. */
function BacklinkList({ links, onPick }: BacklinkListProps) {
    const rootRef = useRef<HTMLUListElement>(null)
    // The link with focus, while focus is in the list. Once it leaves, Tab comes back to the first.
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
    const tabStop = focusedIndex !== null && focusedIndex < links.length ? focusedIndex : 0
    const count = links.length

    const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        const at = Number((e.target as HTMLElement).dataset.index)
        if (Number.isNaN(at)) return
        const next = outlineKeyTarget(e.key, at, count)
        if (next === null) return
        e.preventDefault()
        rootRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
    }

    return (
        <ul
            ref={rootRef}
            aria-label={`Linked from, ${count} ${count === 1 ? 'link' : 'links'}`}
            className="pb-1"
            onKeyDown={onKeyDown}
            onFocus={(e) => {
                const index = Number((e.target as HTMLElement).dataset.index)
                if (!Number.isNaN(index)) setFocusedIndex(index)
            }}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setFocusedIndex(null)
            }}
        >
            {links.map((link, index) => (
                <li key={`${link.path}:${link.line}:${link.column}`}>
                    <button
                        type="button"
                        data-index={index}
                        tabIndex={index === tabStop ? 0 : -1}
                        className="block w-full py-1 ps-3 pe-2 text-left text-xs transition-colors hover:bg-sidebar-accent/60"
                        title={`${link.relative}, line ${link.line}\n${link.text}`}
                        onClick={() => onPick(link)}
                    >
                        <span dir="auto" className="block truncate font-medium">
                            {link.relative}
                        </span>
                        <span dir="auto" className="block truncate text-muted-foreground">
                            {link.text}
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    )
}

type BacklinksSectionProps = { state: BacklinksState; onPick: (link: Backlink) => void }

/**
 * "Linked from": the other notes whose wiki links lead to the Markdown file showing, below its headings. Choosing one
 * opens that note at the link. Memoized: the panel draws again on every keystroke.
 */
export const BacklinksSection = memo(function BacklinksSection({ state, onPick }: BacklinksSectionProps) {
    const headingId = useId()
    if (state.kind === 'none') return null
    const links = state.kind === 'ready' ? state.result.links : null
    return (
        <section aria-labelledby={headingId} className="mt-1 border-t border-sidebar-border">
            <h2 id={headingId} className="flex items-center justify-between gap-2 px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase">
                Linked from
                {links && links.length > 0 ? <span className="tabular-nums">{links.length}</span> : null}
            </h2>
            {state.kind === 'no-folder' ? <Note>Open the folder this file is in to see which notes link to it.</Note> : null}
            {links && links.length === 0 ? <Note>No other notes link here.</Note> : null}
            {links && links.length > 0 ? <BacklinkList links={links} onPick={onPick} /> : null}
            {state.kind === 'ready' && state.result.incomplete ? <Note>{INCOMPLETE}</Note> : null}
        </section>
    )
})
