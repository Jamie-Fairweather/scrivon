/**
 * Folding shared by file-name and content search, so text matches however it was typed or stored:
 * Unicode NFC (macOS keeps accents and Korean syllables as separate parts, a Windows keyboard types
 * them composed) and lower case that keeps one letter per letter.
 */

let graphemeSegmenter: Intl.Segmenter | null | undefined

function segmenter(): Intl.Segmenter | null {
    if (graphemeSegmenter === undefined) {
        graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
    }
    return graphemeSegmenter
}

/** Splits a line into pieces that normalize on their own: grapheme clusters, or code points as a fallback. */
function pieces(line: string): Array<{ segment: string; index: number }> {
    const seg = segmenter()
    if (seg) return Array.from(seg.segment(line), ({ segment, index }) => ({ segment, index }))

    const result: Array<{ segment: string; index: number }> = []
    let index = 0
    for (const segment of line) {
        result.push({ segment, index })
        index += segment.length
    }
    return result
}

/**
 * Lower case that keeps one letter per letter, so positions don't drift and matches aren't missed:
 * Turkish 'İ' becomes 'i' (not 'i' plus a combining dot), and every sigma becomes 'σ' (a word-final
 * 'Σ' would otherwise become 'ς' in a query but 'σ' mid-word in the text).
 */
function lowerCase(text: string): string {
    let lower = text.toLowerCase()
    if (lower.length !== text.length) {
        lower = ''
        for (const ch of text) lower += String.fromCodePoint(ch.toLowerCase().codePointAt(0)!)
    }
    return lower.includes('ς') ? lower.replace(/ς/g, 'σ') : lower
}

export function foldText(text: string): string {
    return lowerCase(text.normalize('NFC'))
}

export type FoldedLine = {
    folded: string
    /**
     * For each code unit of `folded`, where its source starts and ends in the original line.
     * Null when folding kept the length, so positions already line up.
     */
    starts: number[] | null
    ends: number[] | null
}

/** Folds one line and remembers how positions map back, so columns and previews use the original text. */
export function foldLine(line: string): FoldedLine {
    if (line.normalize('NFC') === line) {
        const folded = foldText(line)
        if (folded.length === line.length) return { folded, starts: null, ends: null }
    }

    let folded = ''
    const starts: number[] = []
    const ends: number[] = []
    for (const { segment, index } of pieces(line)) {
        const piece = foldText(segment)
        folded += piece
        for (let i = 0; i < piece.length; i++) {
            starts.push(index)
            ends.push(index + segment.length)
        }
    }
    return { folded, starts, ends }
}

/** Turns a match in `line.folded` into its start and length in the original line. */
export function originalSpan(line: FoldedLine, index: number, length: number): { start: number; length: number } {
    if (!line.starts || !line.ends || length === 0) return { start: index, length }
    const start = line.starts[index]!
    const end = line.ends[index + length - 1]!
    return { start, length: end - start }
}
