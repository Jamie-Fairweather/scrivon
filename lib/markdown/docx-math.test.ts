import { inflateRawSync } from 'node:zlib'
import { Document, Packer, Paragraph } from 'docx'
import { describe, expect, it } from 'vitest'
import { texToWordMath } from '@/lib/markdown/docx-math'

/** The `word/document.xml` of a .docx. */
function documentXml(data: Uint8Array): string {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let offset = 0; offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034b50;) {
        const method = view.getUint16(offset + 8, true)
        const compressed = view.getUint32(offset + 18, true)
        const nameLength = view.getUint16(offset + 26, true)
        const start = offset + 30 + nameLength + view.getUint16(offset + 28, true)
        const name = new TextDecoder().decode(data.subarray(offset + 30, offset + 30 + nameLength))
        const bytes = data.subarray(start, start + compressed)
        if (name === 'word/document.xml') return new TextDecoder().decode(method === 0 ? bytes : inflateRawSync(bytes))
        offset = start + compressed
    }
    throw new Error('no word/document.xml')
}

/** The equation `tex` becomes, as Word reads it: the `<m:oMath>` in a paragraph of its own. */
async function equation(tex: string): Promise<string> {
    const math = texToWordMath(tex)
    expect(math).not.toBeNull()
    const doc = new Document({ sections: [{ children: [new Paragraph({ children: [math!] })] }] })
    const xml = documentXml(new Uint8Array(await Packer.toBuffer(doc)))
    const found = /<m:oMath>[\s\S]*<\/m:oMath>/.exec(xml)
    expect(found).not.toBeNull()
    return found![0]
}

describe('texToWordMath', () => {
    it('writes a fraction as m:f', async () => {
        expect(await equation('\\frac{1}{2}')).toBe(
            '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>'
        )
    })

    it('writes scripts as m:sSup, m:sSub and m:sSubSup', async () => {
        expect(await equation('x^2')).toContain(
            '<m:sSup><m:sSupPr/><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'
        )
        expect(await equation('x_i')).toContain(
            '<m:sSub><m:sSubPr/><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub>'
        )
        const both = await equation('x_i^2')
        expect(both).toContain('<m:sSubSup>')
        expect(both).toContain('<m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>2</m:t></m:r></m:sup>')
    })

    it('writes a square root with its degree hidden, and an nth root with its degree', async () => {
        const square = await equation('\\sqrt{x}')
        expect(square).toContain('<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>')
        expect(square).toContain('<m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>')
        const cube = await equation('\\sqrt[3]{x}')
        expect(cube).toContain('<m:rad>')
        expect(cube).not.toContain('m:degHide')
        expect(cube).toContain('<m:deg><m:r><m:t>3</m:t></m:r></m:deg>')
    })

    it('writes sums and integrals with limits as m:nary', async () => {
        const sum = await equation('\\sum_{i=1}^{n} i')
        expect(sum).toContain('<m:nary><m:naryPr><m:chr m:val="∑"/>')
        expect(sum).toContain('<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup>')
        const integral = await equation('\\int_0^1 f')
        expect(integral).toContain('<m:nary><m:naryPr><m:chr m:val="∫"/>')
        expect(integral).toContain('<m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup>')
    })

    it('writes \\left and \\right as m:d with its brackets', async () => {
        expect(await equation('\\left( x \\right)')).toContain(
            '<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d>'
        )
    })

    it('writes \\sin as m:func, upright', async () => {
        const sin = await equation('\\sin x')
        expect(sin).toContain('<m:func>')
        expect(sin).toContain('<m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName>')
    })

    it('writes \\text as normal text, escaped', async () => {
        expect(await equation('\\text{if a & <b>}')).toContain('<m:r><m:rPr><m:nor m:val="1"/></m:rPr><m:t>if a &amp; &lt;b&gt;</m:t></m:r>')
    })

    it('writes Greek letters and symbols as their Unicode characters', async () => {
        expect(await equation('\\alpha \\leq \\infty')).toContain('<m:r><m:t>α≤∞</m:t></m:r>')
    })

    it('writes pmatrix and bmatrix as m:m inside m:d', async () => {
        const round = await equation('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
        expect(round).toMatch(/^<m:oMath><m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/><\/m:dPr><m:e><m:m>/)
        expect(round.match(/<m:mr>/g)).toHaveLength(2)
        const square = await equation('\\begin{bmatrix} a \\end{bmatrix}')
        expect(square).toMatch(/^<m:oMath><m:d><m:dPr><m:begChr m:val="\["\/><m:endChr m:val="]"\/><\/m:dPr><m:e><m:m>/)
    })

    it('writes cases as m:m inside an m:d that opens with a brace', async () => {
        const cases = await equation('f = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}')
        expect(cases).toContain('<m:d><m:dPr><m:begChr m:val="{"/>')
        expect(cases).toMatch(/<m:d><m:dPr><m:begChr m:val="\{"\/><m:endChr m:val=""\/><\/m:dPr><m:e><m:m>/)
        expect(cases.match(/<m:mr>/g)).toHaveLength(2)
    })

    it('writes aligned as m:eqArr, a row each', async () => {
        const aligned = await equation('\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}')
        expect(aligned).toMatch(/^<m:oMath><m:eqArr>/)
        expect(aligned.match(/<m:e>/g)).toHaveLength(2)
    })

    it('escapes <, > and & in the math', async () => {
        expect(await equation('a < b \\& c > d')).toBe(
            '<m:oMath><m:r><m:t>a&lt;b</m:t></m:r><m:r><m:rPr><m:lit m:val="1"/></m:rPr><m:t>&amp;</m:t></m:r><m:r><m:t>c&gt;d</m:t></m:r></m:oMath>'
        )
    })

    it('gives null for TeX it cannot read, and for no math at all', () => {
        expect(texToWordMath('\\frac{1}{')).toBeNull()
        expect(texToWordMath('\\foo')).toBeNull()
        expect(texToWordMath('\\begin{foo}x\\end{foo}')).toBeNull()
        expect(texToWordMath('')).toBeNull()
        expect(texToWordMath(' \n ')).toBeNull()
        // TeX that reads but holds nothing: an empty equation would show nothing, and lose the TeX.
        for (const tex of ['\\text{}', '\\mathbb{}', '\\mathrm{}', '{}', '\\limits', '\\label{eq:1}']) expect(texToWordMath(tex)).toBeNull()
        expect(texToWordMath('x\\label{eq:1}')).not.toBeNull()
    })

    it('gives every run of letters the run properties asked for, after its math properties and before its text', async () => {
        const math = texToWordMath('\\frac{\\text{a}}{\\mathbb{R}_2}', { size: 30, color: '0969DA' })
        const doc = new Document({ sections: [{ children: [new Paragraph({ children: [math!] })] }] })
        const xml = documentXml(new Uint8Array(await Packer.toBuffer(doc)))
        const run = '<w:rPr><w:color w:val="0969DA"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>'
        expect(xml).toContain(`<m:r><m:rPr><m:nor m:val="1"/></m:rPr>${run}<m:t>a</m:t></m:r>`)
        expect(xml).toContain(`<m:r><m:rPr><m:scr m:val="double-struck"/><m:sty m:val="p"/></m:rPr>${run}<m:t>R</m:t></m:r>`)
        expect(xml).toContain(`<m:r>${run}<m:t>2</m:t></m:r>`)
        expect(xml.split(run)).toHaveLength(4)
        // Without them, the letters have none of their own.
        expect(await equation('x')).toBe('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>')
    })
})
