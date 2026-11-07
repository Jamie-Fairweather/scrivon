import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mdPath = join(__dirname, 'data', 'craft-mermaid-samples.md')
const outPath = join(__dirname, '..', 'lib', 'examples', 'craft-samples.ts')

// Category heading in the contents list -> category id.
const CATEGORY_MAP = {
    Flowchart: 'flowchart',
    State: 'state',
    Sequence: 'sequence',
    Class: 'class',
    ER: 'er',
    'XY Chart': 'xy-chart',
}

// Order of the groups in the Examples explorer. Also the ExampleCategory type.
const CATEGORY_ORDER = ['flowchart', 'state', 'sequence', 'class', 'er', 'xy-chart']

// Sample headings in the body may carry a short category prefix ('## Class: Basic Class'). Flowchart
// headings have none, and some flowchart titles have a colon of their own ('linkStyle: Color-Coded Edges').
const SECTION_PREFIXES = ['Flowchart', 'State', 'Sequence', 'Class', 'ER', 'XY', 'XY Chart']

/**
 * Turns markdown text into the plain text it displays as: `\*` becomes `*`. Code spans are left alone,
 * because backslashes inside them are literal (`[/text\]`).
 */
export function unescapeMarkdown(text) {
    return text.replace(/(`+)[\s\S]*?\1|\\([!-/:-@[-`{-~])/g, (match, ticks, char) => (ticks ? match : char))
}

function parseContents(contents) {
    const entries = []
    const declaredCounts = new Map()
    let category = null

    for (const line of contents.split('\n')) {
        const catMatch = line.match(/^### (.+?) \((\d+) samples\)/)
        if (catMatch) {
            category = CATEGORY_MAP[catMatch[1]]
            if (!category) {
                throw new Error(`Unknown category "${catMatch[1]}" in the contents list. Add it to CATEGORY_MAP and CATEGORY_ORDER.`)
            }
            declaredCounts.set(category, Number(catMatch[2]))
            continue
        }
        const itemMatch = line.match(/^\d+\.\s+\[[^\]]+\]\(#(sample-\d+)\)/)
        if (!itemMatch) continue
        const id = itemMatch[1]
        if (!category) throw new Error(`${id} is listed before any category heading`)
        const titleMatch = line.match(/^\d+\.\s+\[\d+\.\s+(.+?)\]\(#/)
        if (!titleMatch) throw new Error(`Could not read the title of ${id} from: ${line}`)
        if (entries.some((entry) => entry.id === id)) throw new Error(`${id} is listed twice in the contents`)
        entries.push({ id, category, title: unescapeMarkdown(titleMatch[1].trim()) })
    }

    for (const [cat, declared] of declaredCounts) {
        const listed = entries.filter((entry) => entry.category === cat).length
        if (listed !== declared) throw new Error(`The ${cat} heading says ${declared} samples but ${listed} are listed`)
    }

    return entries
}

function parseSections(body) {
    const sections = []

    for (const rawSection of body.split(/\n(?=## )/).slice(1)) {
        const section = rawSection.trim()
        const headingMatch = section.match(/^## (.+?)(?:\n|$)/)
        if (!headingMatch) continue
        const heading = unescapeMarkdown(headingMatch[1].trim())

        const rest = section.slice(headingMatch[0].length)
        const descMatch = rest.match(/^([^\n`][^\n]*)\n/m)
        const description = descMatch ? unescapeMarkdown(descMatch[1].trim()) : ''

        let source = ''
        for (const [, content] of rest.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
            const trimmed = content.trim()
            if (!trimmed || trimmed === 'Rendering…' || trimmed.startsWith('Options:')) continue
            source = trimmed
            break
        }
        if (!source) throw new Error(`Sample "${heading}" has no diagram code`)

        sections.push({ heading, description, source, used: false })
    }

    return sections
}

/** Pairs each sample in the contents list with the body section of the same title. Throws on any mismatch. */
export function parseMarkdown(md) {
    const missingOrder = Object.values(CATEGORY_MAP).filter((cat) => !CATEGORY_ORDER.includes(cat))
    if (missingOrder.length > 0) throw new Error(`Add ${missingOrder.join(', ')} to CATEGORY_ORDER`)

    const samplesStart = md.indexOf('\n## Samples')
    if (samplesStart === -1) throw new Error('## Samples section not found')

    const entries = parseContents(md.slice(0, samplesStart))
    const sections = parseSections(md.slice(samplesStart + 1))

    const examples = entries.map((entry) => {
        const headings = [entry.title, ...SECTION_PREFIXES.map((prefix) => `${prefix}: ${entry.title}`)]
        const matches = sections.filter((section) => headings.includes(section.heading))
        if (matches.length === 0) throw new Error(`No sample section titled "${entry.title}" (${entry.id})`)
        if (matches.length > 1) throw new Error(`More than one sample section titled "${entry.title}" (${entry.id})`)
        const [section] = matches
        if (section.used) throw new Error(`Sample section "${section.heading}" matches two entries in the contents`)
        section.used = true
        return {
            id: entry.id,
            category: entry.category,
            title: entry.title,
            description: section.description,
            source: section.source,
        }
    })

    const unlisted = sections.filter((section) => !section.used).map((section) => `"${section.heading}"`)
    if (unlisted.length > 0) throw new Error(`Sample sections missing from the contents list: ${unlisted.join(', ')}`)

    return examples
}

function escapeTemplate(str) {
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

export function emitTs(examples) {
    const lines = [
        '// Generated by scripts/generate-examples.mjs — do not edit manually.',
        '// Source: scripts/data/craft-mermaid-samples.md (https://agents.craft.do/mermaid)',
        '',
        `export type ExampleCategory = ${CATEGORY_ORDER.map((cat) => `'${cat}'`).join(' | ')}`,
        '',
        'export const EXAMPLE_CATEGORIES: ExampleCategory[] = ' + JSON.stringify(CATEGORY_ORDER),
        '',
        'export type CraftExample = {',
        '    id: string',
        '    category: ExampleCategory',
        '    title: string',
        '    description: string',
        '    source: string',
        '}',
        '',
        'export const CRAFT_EXAMPLES: CraftExample[] = [',
    ]

    for (const ex of examples) {
        lines.push('    {')
        lines.push(`        id: ${JSON.stringify(ex.id)},`)
        lines.push(`        category: ${JSON.stringify(ex.category)},`)
        lines.push(`        title: ${JSON.stringify(ex.title)},`)
        lines.push(`        description: ${JSON.stringify(ex.description)},`)
        lines.push(`        source: \`${escapeTemplate(ex.source)}\`,`)
        lines.push('    },')
    }

    lines.push(']')
    lines.push('')
    lines.push('export const CRAFT_EXAMPLE_BY_ID: Record<string, CraftExample> = Object.fromEntries(')
    lines.push('    CRAFT_EXAMPLES.map((e) => [e.id, e])')
    lines.push(')')
    lines.push('')

    return lines.join('\n')
}

const markdownShowcasePath = join(__dirname, 'data', 'markdown-syntax-showcase.md')
const markdownOutPath = join(__dirname, '..', 'lib', 'examples', 'markdown-showcase.ts')

function emitMarkdownShowcase(content) {
    return [
        '// Generated by scripts/generate-examples.mjs — do not edit manually.',
        '// Source: scripts/data/markdown-syntax-showcase.md',
        '',
        "import type { AppExample } from '@/lib/examples/types'",
        '',
        'export const MARKDOWN_SHOWCASE: AppExample = {',
        "    id: 'markdown-syntax-showcase',",
        "    category: 'markdown',",
        "    title: 'Markdown syntax showcase',",
        "    description: 'CommonMark and GFM features with inline Mermaid, code blocks, and tables.',",
        `    source: \`${escapeTemplate(content.trim())}\`,`,
        '}',
        '',
    ].join('\n')
}

function main() {
    const md = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n')
    const examples = parseMarkdown(md)
    writeFileSync(outPath, emitTs(examples), 'utf8')
    console.log(`Wrote ${examples.length} examples to ${outPath}`)

    const markdownShowcase = readFileSync(markdownShowcasePath, 'utf8').replace(/\r\n/g, '\n')
    writeFileSync(markdownOutPath, emitMarkdownShowcase(markdownShowcase), 'utf8')
    console.log(`Wrote markdown showcase to ${markdownOutPath}`)
}

// Run only when called as a script, so tests can import the helpers above.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? entryPath.toLowerCase() === selfPath.toLowerCase() : entryPath === selfPath
if (isMain) {
    try {
        main()
    } catch (error) {
        // Fail the build: writing half-matched examples would pair titles with the wrong diagrams.
        console.error(`generate-examples: ${error instanceof Error ? error.message : error}`)
        process.exit(1)
    }
}
