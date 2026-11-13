import type { Element } from 'hast'
import { EXIT, SKIP, visit } from 'unist-util-visit'
import { isAlertTitle } from '@/lib/markdown/github-alerts'

/** Letters of right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko and the rest, with their presentation forms. */
export const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u

/** Whether a block reads right to left. Like the browser's `dir="auto"`, its first letter decides. */
export function isRtl(text: string): boolean {
    const first = /\p{L}/u.exec(text)?.[0]
    return first !== undefined && RTL_LETTER.test(first)
}

/**
 * The direction for a quote or list item. Its words sit in child paragraphs that have dir="auto" of their own,
 * and the browser's `dir="auto"` skips those, so the block would always read left to right and keep its quote
 * bar or bullet on the left. Instead its first letter decides, as Word decides. Code blocks and an alert's English
 * title don't count, and neither does any text in `ignored`.
 */
export function blockDirection(node: Element, ignored?: ReadonlySet<string>): 'rtl' | 'auto' {
    let rtl = false
    visit(node, (child) => {
        if (child.type === 'element' && (child.tagName === 'pre' || isAlertTitle(child))) return SKIP
        if (child.type !== 'text' || ignored?.has(child.value) || !/\p{L}/u.test(child.value)) return
        rtl = isRtl(child.value)
        return EXIT
    })
    return rtl ? 'rtl' : 'auto'
}
