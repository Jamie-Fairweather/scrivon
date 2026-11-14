import type { Element } from 'hast'
import type { Blockquote, Paragraph, Root } from 'mdast'

export const GITHUB_ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type GithubAlertKind = (typeof GITHUB_ALERT_KINDS)[number]

declare module 'mdast' {
    interface BlockquoteData {
        /** Set on a quote that is a GitHub alert (`> [!NOTE]`). See {@link remarkGithubAlerts}. */
        githubAlert?: GithubAlertKind
    }
}

export const GITHUB_ALERT_TITLES: Record<GithubAlertKind, string> = {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution',
}

/** GitHub's own colours for each kind, on a white page: the PDF and Word use them. */
export const GITHUB_ALERT_COLOURS: Record<GithubAlertKind, string> = {
    note: '0969DA',
    tip: '1A7F37',
    important: '8250DF',
    warning: '9A6700',
    caution: 'CF222E',
}

/** `[!NOTE]` at the start of the quote, alone on its line. Any case, as on GitHub. */
const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(\r?\n|$)/i

/** The kind of alert a quote is, or undefined for a plain quote. */
export function githubAlertKind(node: Blockquote): GithubAlertKind | undefined {
    return node.data?.githubAlert
}

function hasClass(node: Element, name: string): boolean {
    const classes: unknown = node.properties.className
    return Array.isArray(classes) && classes.includes(name)
}

/** The kind of alert an HTML element is (`<div class="markdown-alert markdown-alert-note">`), or undefined. */
export function htmlAlertKind(node: Element): GithubAlertKind | undefined {
    if (node.tagName !== 'div' || !hasClass(node, 'markdown-alert')) return undefined
    return GITHUB_ALERT_KINDS.find((kind) => hasClass(node, `markdown-alert-${kind}`))
}

/** Whether an HTML element is an alert's title. */
export function isAlertTitle(node: Element): boolean {
    return node.tagName === 'p' && hasClass(node, 'markdown-alert-title')
}

/** Takes the `[!NOTE]` line off the quote's first paragraph. Returns the kind, or null when the quote has none. */
function takeMarker(quote: Blockquote): GithubAlertKind | null {
    const paragraph = quote.children[0]
    if (paragraph?.type !== 'paragraph') return null
    const [first, next] = paragraph.children
    if (first?.type !== 'text') return null
    const match = MARKER.exec(first.value)
    if (!match) return null
    const rest = first.value.slice(match[0].length)
    // The marker ends the text: the line goes on only if something other than a line break comes next.
    const endsText = match[2] === ''
    if (endsText && next && next.type !== 'break') return null

    first.value = rest
    if (!rest) paragraph.children.splice(0, endsText && next?.type === 'break' ? 2 : 1)
    if (paragraph.children.length === 0) quote.children.shift()
    return match[1]!.toLowerCase() as GithubAlertKind
}

/**
 * GitHub's alerts: a quote that starts with `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` on
 * its own line becomes a callout with that title, written as GitHub writes it in HTML. As on GitHub, only a quote at
 * the top level of the document counts, not one in a list or another quote.
 */
export function remarkGithubAlerts() {
    return (tree: Root) => {
        for (const node of tree.children) {
            if (node.type !== 'blockquote') continue
            const kind = takeMarker(node)
            if (!kind) continue
            const title: Paragraph = {
                type: 'paragraph',
                data: { hProperties: { className: ['markdown-alert-title'] } },
                children: [{ type: 'text', value: GITHUB_ALERT_TITLES[kind] }],
            }
            node.children.unshift(title)
            node.data = {
                ...node.data,
                githubAlert: kind,
                hName: 'div',
                hProperties: { className: ['markdown-alert', `markdown-alert-${kind}`] },
            }
        }
    }
}
