import type { DocumentKind } from '@/lib/workspace/file-types'

export type TemplateValues = {
    /** The new file's title, made from its name (see titleFromFileName). */
    title: string
    /** The moment the file is made, for `{{date}}` and `{{time}}`, in local time. */
    now: Date
    /** What the template makes. In a diagram, `id{{text}}` is a hexagon node, not a placeholder. */
    kind: DocumentKind
}

/** `{{name}}`, with spaces or tabs allowed inside the braces. */
const PLACEHOLDER = /\{\{[ \t]*([A-Za-z]+)[ \t]*\}\}/g

/** A character a Mermaid node id can end with, so `{{` straight after one opens a hexagon node's text. */
const NODE_ID_END = /[A-Za-z0-9_-]/

const twoDigits = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DD` in local time. */
export function formatTemplateDate(now: Date): string {
    return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`
}

/** `HH:mm`, 24-hour, in local time. */
export function formatTemplateTime(now: Date): string {
    return `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`
}

/**
 * A template's text with `{{title}}`, `{{date}}` and `{{time}}` filled in. Any other `{{…}}` is left as typed, and so
 * is a placeholder in a diagram that comes straight after a letter, digit, `_` or `-` (`A{{Decide}}` is a hexagon node).
 */
export function fillTemplate(source: string, { title, now, kind }: TemplateValues): string {
    const values: Record<string, string> = { title, date: formatTemplateDate(now), time: formatTemplateTime(now) }
    return source.replace(PLACEHOLDER, (match: string, name: string, offset: number) => {
        if (kind === 'mermaid' && offset > 0 && NODE_ID_END.test(source[offset - 1]!)) return match
        return Object.hasOwn(values, name) ? values[name]! : match
    })
}
