/**
 * Turning a file's bytes into text and back without changing how the file is stored.
 *
 * A plain UTF-8 decoder quietly swaps bytes it doesn't understand for "�" and drops a byte-order mark,
 * so saving would rewrite UTF-16 or ANSI files with those swaps baked in. Here every file keeps its
 * encoding and mark, and text that can't be read safely is flagged so it opens read-only.
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be'

/** How a file's text is stored on disk, so a save writes it back the same way. */
export type TextFileFormat = { encoding: TextEncodingName; bom: boolean }

export const DEFAULT_TEXT_FORMAT: TextFileFormat = { encoding: 'utf-8', bom: false }

/**
 * Why a file can't be edited safely:
 * - `legacy-encoding`: the bytes aren't valid UTF-8, most likely an old ANSI file. The text is shown as Windows-1252.
 * - `binary`: the text holds NUL characters, so it's binary or in an encoding that isn't recognised.
 */
export type TextDecodeIssue = 'legacy-encoding' | 'binary'

export type DecodedText = { content: string; format: TextFileFormat; issue?: TextDecodeIssue }

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
    return prefix.every((byte, i) => bytes[i] === byte)
}

/** Decodes or throws: no byte is ever replaced with "�". The mark has already been cut off. */
function decodeStrict(encoding: TextEncodingName, bytes: Uint8Array): string {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes)
}

/** Decodes as well as possible, for showing text that won't be saved. */
function decodeLoose(encoding: TextEncodingName | 'windows-1252', bytes: Uint8Array): string {
    return new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes)
}

export function decodeText(bytes: Uint8Array): DecodedText {
    const marked: Array<[number[], TextEncodingName]> = [
        [UTF8_BOM, 'utf-8'],
        [UTF16LE_BOM, 'utf-16le'],
        [UTF16BE_BOM, 'utf-16be'],
    ]
    for (const [mark, encoding] of marked) {
        if (!startsWith(bytes, mark)) continue
        const body = bytes.subarray(mark.length)
        const format = { encoding, bom: true }
        try {
            return { content: decodeStrict(encoding, body), format }
        } catch {
            // The mark says one thing and the bytes another, so the file is damaged or not text.
            return { content: decodeLoose(encoding, body), format, issue: 'binary' }
        }
    }

    let content: string
    try {
        content = decodeStrict('utf-8', bytes)
    } catch {
        // Windows-1252 maps every byte to its own character, so nothing is lost in what is shown.
        return { content: decodeLoose('windows-1252', bytes), format: DEFAULT_TEXT_FORMAT, issue: 'legacy-encoding' }
    }
    // Valid UTF-8 never needs NUL in a text file; UTF-16 without a mark looks like this.
    if (content.includes('\0')) return { content, format: DEFAULT_TEXT_FORMAT, issue: 'binary' }
    return { content, format: DEFAULT_TEXT_FORMAT }
}

export function encodeText(content: string, format: TextFileFormat = DEFAULT_TEXT_FORMAT): Uint8Array {
    if (format.encoding === 'utf-8') {
        const body = new TextEncoder().encode(content)
        if (!format.bom) return body
        const out = new Uint8Array(UTF8_BOM.length + body.length)
        out.set(UTF8_BOM)
        out.set(body, UTF8_BOM.length)
        return out
    }

    const littleEndian = format.encoding === 'utf-16le'
    const mark = format.bom ? (littleEndian ? UTF16LE_BOM : UTF16BE_BOM) : []
    const out = new Uint8Array(mark.length + content.length * 2)
    out.set(mark)
    for (let i = 0; i < content.length; i++) {
        const unit = content.charCodeAt(i)
        const at = mark.length + i * 2
        out[at] = littleEndian ? unit & 0xff : unit >> 8
        out[at + 1] = littleEndian ? unit >> 8 : unit & 0xff
    }
    return out
}
