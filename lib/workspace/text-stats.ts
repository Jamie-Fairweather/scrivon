/** Word and character counts (for the status bar), and the line endings a text uses. */

/**
 * One Chinese or Japanese character (counted as a word each, as word processors do, since these
 * languages don't put spaces between words), or a run of other characters up to the next space.
 */
const WORD_PIECE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

/** Words split by spaces. A run with no letter or number in it (a "#", "-" or "---") isn't a word. */
export function countWords(text: string): number {
    let words = 0
    for (const match of text.matchAll(WORD_PIECE)) {
        if (match[1] !== undefined || LETTER_OR_NUMBER.test(match[0])) words++
    }
    return words
}

/** Characters, spaces included, but not line breaks, so a file's line endings don't change the count. */
export function countCharacters(text: string): number {
    let count = 0
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code === 10 || code === 13) continue
        // The second half of a character outside the basic range (an emoji, say) was counted with the first.
        if (code >= 0xdc00 && code <= 0xdfff && i > 0) {
            const before = text.charCodeAt(i - 1)
            if (before >= 0xd800 && before <= 0xdbff) continue
        }
        count++
    }
    return count
}

export type LineEndings = 'CRLF' | 'LF' | 'mixed'

/** The line ending the text uses, 'mixed' when it uses more than one, or null when it has no line break. */
export function lineEndingsOf(text: string): LineEndings | null {
    const crlf = text.includes('\r\n')
    const lf = /(?<!\r)\n/.test(text)
    const cr = /\r(?!\n)/.test(text)
    if (cr || (crlf && lf)) return 'mixed'
    if (crlf) return 'CRLF'
    return lf ? 'LF' : null
}
