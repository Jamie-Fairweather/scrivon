import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Checks the official mermaid package (lib/mermaid/render-official.ts) in the static export in out/:
 *
 * - It isn't in the chunks the app loads at launch. It is about 3 MB and only needed for the diagram types
 *   beautiful-mermaid can't draw, so it is loaded with import() the first time one is drawn.
 * - Its chunks never call `new Function(` or `eval(`. The app's CSP (`script-src 'self' 'wasm-unsafe-eval'` in
 *   src-tauri/tauri.conf.json) blocks both, so such a diagram would fail to draw only in the built app.
 *
 * Mermaid's chunks are found from its own code (a string only mermaid's core has), then every chunk the bundle
 * loads alongside it or from it. The unit tests can't see either problem: they don't use the bundle.
 *
 * Run after `bun run build`: node scripts/check-lazy-mermaid.mjs
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out')
const chunksDir = join(out, '_next', 'static', 'chunks')

/** A log message in mermaid's config code, which minifying keeps and no other package has. */
const MERMAID_MARKER = 'Denied attempt to modify a secure key'
const CHUNK_PATH = /static\/chunks\/[\w.~-]+\.js/g
/** What the CSP blocks. A property or method called `eval` (`x.eval(`, `evaluate(`) is not a call to it. */
const BLOCKED = [
    ['new Function(', /\bnew\s+Function\s*\(/],
    ['eval(', /(?<![\w$.])eval\s*\(/],
]

if (!existsSync(chunksDir)) {
    console.error('No out/ folder. Run `bun run build` first.')
    process.exit(1)
}

const chunkNames = readdirSync(chunksDir).filter((name) => name.endsWith('.js'))
const code = new Map(chunkNames.map((name) => [`static/chunks/${name}`, readFileSync(join(chunksDir, name), 'utf8')]))

/** The chunks every page loads as it opens: those its HTML names. */
function launchChunks() {
    const launch = new Set()
    for (const page of readdirSync(out).filter((name) => name.endsWith('.html'))) {
        for (const [path] of readFileSync(join(out, page), 'utf8').matchAll(CHUNK_PATH)) launch.add(path)
    }
    return launch
}

/**
 * Mermaid's chunks: those with its core, the chunks loaded together with them (listed beside them wherever the
 * bundle loads them), and every chunk they load in turn (its diagram types).
 */
function mermaidChunks() {
    const found = new Set([...code].filter(([, text]) => text.includes(MERMAID_MARKER)).map(([path]) => path))
    if (found.size === 0) return found
    // Turbopack loads a dynamic import's chunks as one list: `["static/chunks/a.js","static/chunks/b.js"]`.
    const lists = [...code.values()].flatMap((text) => [...text.matchAll(/\[(?:"static\/chunks\/[\w.~-]+\.js",?)+\]/g)].map(([list]) => JSON.parse(list)))
    for (let grew = true; grew; ) {
        grew = false
        const add = (path) => {
            if (code.has(path) && !found.has(path)) {
                found.add(path)
                grew = true
            }
        }
        for (const list of lists) if (list.some((path) => found.has(path))) list.forEach(add)
        for (const path of [...found]) for (const [next] of code.get(path).matchAll(CHUNK_PATH)) add(next)
    }
    return found
}

let failed = false
const launch = launchChunks()
const mermaid = mermaidChunks()

if (launch.size === 0) {
    failed = true
    console.error('✗ Found no launch chunks in out/*.html. Has the way Next.js lists its scripts changed?')
}
if (mermaid.size === 0) {
    failed = true
    console.error(`✗ Found no chunk with mermaid in it ("${MERMAID_MARKER}"). Has mermaid changed, or is it no longer bundled?`)
}

const atLaunch = [...mermaid].filter((path) => launch.has(path) && code.get(path).includes(MERMAID_MARKER))
if (atLaunch.length > 0) {
    failed = true
    console.error(`✗ The app loads mermaid at launch, in ${atLaunch.join(', ')}. It should only load when a diagram needs it (import()).`)
} else if (mermaid.size > 0) {
    console.log(`✓ Mermaid isn't in the ${launch.size} launch chunks`)
}

for (const path of mermaid) {
    const text = code.get(path)
    for (const [name, pattern] of BLOCKED) {
        const match = pattern.exec(text)
        if (!match) continue
        failed = true
        const at = match.index
        console.error(`✗ ${path} calls ${name}, which the CSP blocks: …${text.slice(Math.max(0, at - 60), at + 40)}…`)
    }
}
if (!failed) console.log(`✓ Mermaid's ${mermaid.size} chunks call neither new Function( nor eval(`)

process.exit(failed ? 1 : 0)
