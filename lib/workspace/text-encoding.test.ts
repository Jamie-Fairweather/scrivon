import { describe, expect, it } from 'vitest'
import { decodeText, encodeText } from './text-encoding'

const bytes = (...values: number[]) => new Uint8Array(values)

/** "# Café" as Windows PowerShell 5.1 `>` writes it: UTF-16 LE with a byte-order mark. */
const UTF16LE_CAFE = bytes(0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00)

describe('decodeText and encodeText', () => {
    it('reads plain UTF-8 and writes it back unchanged', () => {
        const file = bytes(...new TextEncoder().encode('# Café ✓'))
        const decoded = decodeText(file)
        expect(decoded).toEqual({ content: '# Café ✓', format: { encoding: 'utf-8', bom: false } })
        expect(encodeText(decoded.content, decoded.format)).toEqual(file)
    })

    it('keeps the byte-order mark of a UTF-8 file', () => {
        const file = bytes(0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xa9)
        const decoded = decodeText(file)
        expect(decoded).toEqual({ content: 'Aé', format: { encoding: 'utf-8', bom: true } })
        expect(encodeText(decoded.content, decoded.format)).toEqual(file)
    })

    it('reads UTF-16 LE and BE files and writes them back byte for byte', () => {
        const le = decodeText(UTF16LE_CAFE)
        expect(le).toEqual({ content: '# Café', format: { encoding: 'utf-16le', bom: true } })
        expect(encodeText(le.content, le.format)).toEqual(UTF16LE_CAFE)

        const beFile = bytes(0xfe, 0xff, 0x00, 0x41, 0xd8, 0x3d, 0xde, 0x00)
        const be = decodeText(beFile)
        expect(be).toEqual({ content: 'A😀', format: { encoding: 'utf-16be', bom: true } })
        expect(encodeText(be.content, be.format)).toEqual(beFile)
    })

    it('saves an edit to a UTF-16 file as UTF-16, keeping accented letters', () => {
        const le = decodeText(UTF16LE_CAFE)
        const saved = encodeText(`${le.content}!`, le.format)
        expect(decodeText(saved).content).toBe('# Café!')
        expect([...saved.subarray(0, 2)]).toEqual([0xff, 0xfe])
    })

    it('flags an ANSI file instead of turning its accents into replacement characters', () => {
        const decoded = decodeText(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x80))
        expect(decoded.issue).toBe('legacy-encoding')
        expect(decoded.content).toBe('Café €')
        expect(decoded.content).not.toContain('�')
    })

    it('flags text with NUL characters, such as UTF-16 without a mark, as binary', () => {
        expect(decodeText(bytes(0x41, 0x00, 0x42, 0x00)).issue).toBe('binary')
        // A mark followed by bytes that don't fit it.
        expect(decodeText(bytes(0xff, 0xfe, 0x41)).issue).toBe('binary')
    })

    it('treats an empty file as plain UTF-8', () => {
        expect(decodeText(new Uint8Array())).toEqual({ content: '', format: { encoding: 'utf-8', bom: false } })
        expect(encodeText('')).toEqual(new Uint8Array())
    })
})
