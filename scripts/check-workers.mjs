import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * Loads each web worker from the static export in out/, as the browser would, in a sandbox with no
 * page (no `document` or `window`), and checks it loads without an error. A worker that fails as it
 * loads tells the page nothing; it just never answers. The unit tests can't see this, because they
 * don't use the bundle: Turbopack picks a package's "browser" build for workers, and a "browser" build
 * may need a page (decode-named-character-reference's did, which stopped the spell check).
 *
 * The spell check worker is also asked to check a misspelt word, so a missing dictionary fails too.
 *
 * Run after `bun run build`: node scripts/check-workers.mjs
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out')
const chunksDir = join(out, '_next', 'static', 'chunks')
const ORIGIN = 'http://tauri.localhost'
/** How long a worker gets to finish loading and send its first messages. */
const SETTLE_MS = 3000

if (!existsSync(chunksDir)) {
    console.error('No out/ folder. Run `bun run build` first.')
    process.exit(1)
}

/** Every worker the app starts: `f("static/chunks/turbopack-worker-….js", [its chunks])` in the bundle. */
function findWorkers() {
    const workers = new Map()
    const pattern = /\.f\("(static\/chunks\/turbopack-worker-[^"]+\.js)",(\[[^\]]*\])\)/g
    for (const file of readdirSync(chunksDir).filter((name) => name.endsWith('.js'))) {
        const text = readFileSync(join(chunksDir, file), 'utf8')
        for (const [, bootstrap, list] of text.matchAll(pattern)) {
            const chunks = JSON.parse(list)
            workers.set(chunks.join(','), { bootstrap, chunks })
        }
    }
    return [...workers.values()]
}

function readOutFile(url) {
    const path = new URL(url, ORIGIN).pathname
    return readFileSync(join(out, ...path.split('/').filter(Boolean)), 'utf8')
}

/** The workers the app starts, each told apart by a string only its own code has. The first that matches wins. */
const KINDS = [
    ['spell check', '"suggested"'], // lib/spellcheck/spellcheck-worker-core.ts
    ['outline', 'headings:'], // lib/markdown/outline.worker.ts
    ['Mermaid', '"rendered"'], // lib/mermaid/render-worker-core.ts
    ['Monaco', '$computeDiff'], // Monaco's editor worker (lib/monaco/editor.worker.ts)
]

/** Which worker this is, or null if none of them. */
function workerKind({ chunks }) {
    const code = chunks.map((chunk) => readOutFile(`/_next/${chunk}`)).join('\n')
    return KINDS.find(([, marker]) => code.includes(marker))?.[0] ?? null
}

/** Runs one worker in a sandbox. Resolves with what it sent and any error it hit. */
async function runWorker({ bootstrap, chunks }, request) {
    const sent = []
    const errors = []
    const listeners = []
    // As the page builds it (the `f` helper next to the worker's chunk list): the chunks in reverse order,
    // then the asset suffix, base path, deployment id and client asset suffix.
    const params = [chunks.map((chunk) => `/_next/${chunk}`).reverse(), '', '/_next/', null, null]
    const href = `${ORIGIN}/_next/${bootstrap}#params=${encodeURIComponent(JSON.stringify(params))}`

    // Turbopack's worker bootstrap checks `self instanceof self.WorkerGlobalScope`. The sandbox's global
    // object isn't made by a class, so this one says yes to it.
    const WorkerGlobalScope = { [Symbol.hasInstance]: () => true }
    const scope = Object.assign(Object.create(null), {
        WorkerGlobalScope,
        location: new URL(href),
        console,
        URL,
        URLSearchParams,
        TextDecoder,
        TextEncoder,
        Blob,
        structuredClone,
        atob,
        btoa,
        performance,
        queueMicrotask,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        postMessage: (message) => sent.push(message),
        addEventListener: (type, listener) => {
            if (type === 'message') listeners.push(listener)
        },
        removeEventListener: () => {},
    })
    scope.self = scope
    scope.globalThis = scope
    const context = vm.createContext(scope)
    scope.importScripts = (...urls) => {
        for (const url of urls) vm.runInContext(readOutFile(url), context, { filename: url })
    }

    const onRejection = (reason) => errors.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
        vm.runInContext(readOutFile(href), context, { filename: bootstrap })
    } catch (err) {
        errors.push(err)
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    if (request && sent.some((message) => message?.type === 'ready')) {
        listeners.forEach((listener) => listener({ data: request }))
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }
    process.off('unhandledRejection', onRejection)
    return { sent, errors }
}

/**
 * An error's name and message, then where it happened. The message goes first: for an error in the sandbox the
 * stack starts with the file, the line of code and a caret, which would push it out of view.
 */
function describeError(err) {
    if (typeof err?.message !== 'string') return String(err)
    const at = String(err.stack ?? '')
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '))
        .slice(0, 3)
    return [`${err.name ?? 'Error'}: ${err.message}`, ...at].join('\n')
}

const workers = findWorkers()
if (workers.length === 0) {
    console.error('Found no workers in out/. Has the way Turbopack starts workers changed?')
    process.exit(1)
}

let failed = false
let spellcheckFound = false
const spellRequest = { type: 'check', id: 1, language: 'en-US', words: [], text: 'This has a mispelt wurd.', document: 'check' }

for (const worker of workers) {
    const kind = workerKind(worker)
    const spellcheck = kind === 'spell check'
    if (spellcheck) spellcheckFound = true
    const { sent, errors } = await runWorker(worker, spellcheck ? spellRequest : null)
    const name = `${kind ? `the ${kind} worker, ` : ''}${worker.chunks[0]}`
    if (errors.length > 0) {
        failed = true
        console.error(`✗ A worker (${name}) failed to load:`, ...errors.map(describeError))
        continue
    }
    if (spellcheck) {
        const answer = sent.find((message) => message?.id === spellRequest.id)
        const words = answer?.type === 'checked' ? answer.misspellings.map((m) => m.word) : null
        if (!sent.some((message) => message?.type === 'ready')) {
            failed = true
            console.error(`✗ The spell check worker (${name}) never said it was ready.`)
        } else if (!words || !words.includes('mispelt') || !words.includes('wurd')) {
            failed = true
            console.error(`✗ The spell check worker (${name}) didn't find the misspelt words. It answered:`, answer)
        } else {
            console.log(`✓ The spell check worker loads and finds misspelt words (${name})`)
        }
        continue
    }
    console.log(`✓ A worker loads (${name})`)
}

if (!spellcheckFound) {
    failed = true
    console.error('✗ Found no spell check worker in out/.')
}
process.exit(failed ? 1 : 0)
