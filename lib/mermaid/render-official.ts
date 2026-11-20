import type { Mermaid } from 'mermaid'
import { normaliseOfficialSvg } from '@/lib/mermaid/official-svg'
import { officialMermaidConfig } from '@/lib/mermaid/official-theme'
import { RENDER_TIMEOUT_MESSAGE, RENDER_TIMEOUT_MS, RendererLoadError } from '@/lib/mermaid/render-errors'
import { getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'

/**
 * Draws the diagram types beautiful-mermaid can't (pie charts, Gantt charts, mind maps and the rest: see
 * chooseDiagramEngine) with the official `mermaid` package. It needs a real page to measure text in, so it runs on
 * the main thread, not in the diagram worker, and it is loaded the first time one of these diagrams is drawn, so it
 * adds nothing to launch.
 *
 * Mermaid's settings are global, so renders run one at a time, and each sets them (`mermaid.initialize`) and then
 * draws, as one step. The preview (through render-client.ts) and exports both queue here, so an export in its own
 * theme can't lend its colours to a preview render running beside it, or the other way round.
 */

let mermaidModule: Promise<Mermaid> | null = null

/** A failed load (the chunk couldn't be fetched) isn't kept: the next render tries again. */
function loadMermaid(): Promise<Mermaid> {
    mermaidModule ??= import('mermaid').then(
        (module) => module.default,
        (err: unknown) => {
            mermaidModule = null
            throw err
        }
    )
    return mermaidModule
}

export type OfficialRenderOptions = {
    /** No backdrop behind the diagram, as in the preview. Default true; an export with a background sets it false. */
    transparent?: boolean
}

/** Tells this page's renders apart from those of another window whose pictures end up in the same file. */
const RUN_ID = Math.random().toString(36).slice(2, 8)
let renders = 0
/** The last render queued. The next one starts once it has finished, however it finished. */
let queueTail: Promise<unknown> = Promise.resolve()

const ignore = () => {}

/** What Mermaid adds to the page for one render: the picture, the box it measures in, and a sandbox frame. */
function removeRenderElements(id: string): void {
    if (typeof document === 'undefined') return
    for (const elementId of [id, `d${id}`, `i${id}`]) document.getElementById(elementId)?.remove()
}

/**
 * And what some diagram types add and normally take away themselves: a hidden box for laying out a mind map or an
 * architecture diagram, and a tooltip. Only removed between renders, never while another may be using them.
 */
function removeSharedElements(): void {
    if (typeof document === 'undefined') return
    for (const element of document.body.querySelectorAll(':scope > #cy, :scope > .mermaidTooltip')) element.remove()
}

/** The page's own top-level elements, before a render: none of them is ever removed. */
function bodyChildren(): ReadonlySet<Element> {
    return typeof document === 'undefined' ? new Set() : new Set(document.body.children)
}

/**
 * The box Mermaid measures text in: a bare `<svg>` added to the body, which it takes away again only when measuring
 * worked. Only one added since the render began is removed, so nothing of the page's own goes.
 */
function removeMeasuringBoxes(before: ReadonlySet<Element>): void {
    if (typeof document === 'undefined') return
    for (const element of document.body.querySelectorAll(':scope > svg:not([id])')) {
        if (!before.has(element)) element.remove()
    }
}

/**
 * How long the next render waits for one that timed out to end. Mermaid runs its renders one at a time too, so
 * until then the next would only queue behind it inside Mermaid, with its own time running out. After this long
 * it goes ahead anyway, so one render that never ends can't hold up every one after it for good.
 */
export const STUCK_RENDER_WAIT_MS = RENDER_TIMEOUT_MS

/** Resolves once `work` has settled, or after `ms`, whichever comes first. */
function settledOrAfter(work: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        const done = () => {
            clearTimeout(timer)
            resolve()
        }
        work.then(done, done)
    })
}

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err))
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(RENDER_TIMEOUT_MESSAGE)), RENDER_TIMEOUT_MS)
        work.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (err: unknown) => {
                clearTimeout(timer)
                reject(asError(err))
            }
        )
    })
}

/**
 * One render. `onDrawing` is given a promise that settles once Mermaid has really finished with it, which for a
 * render that timed out is later than the one this returns.
 */
async function runRender(source: string, themeId: AppThemeId, transparent: boolean, onDrawing: (finished: Promise<void>) => void): Promise<string> {
    let mermaid: Mermaid
    try {
        mermaid = await loadMermaid()
    } catch (err) {
        throw new RendererLoadError(err)
    }

    const id = `scrivon-mermaid-${RUN_ID}-${++renders}`
    const before = bodyChildren()
    const cleanUp = () => {
        removeRenderElements(id)
        removeMeasuringBoxes(before)
    }
    const drawing = (async () => {
        // Settings and drawing as one step: render reads the settings before it first waits.
        mermaid.initialize(officialMermaidConfig(themeId))
        // The original text: Mermaid reads its front matter, `%%{init}%%` and accTitle/accDescr itself.
        const { svg } = await mermaid.render(id, source)
        return svg
    })()
    // A render that timed out may still finish later: what it added goes then, before the next render starts.
    onDrawing(drawing.then(cleanUp, cleanUp))
    try {
        const svg = await withTimeout(drawing)
        return normaliseOfficialSvg(svg, { id, background: transparent ? null : getDiagramColors(themeId).bg })
    } finally {
        cleanUp()
        removeSharedElements()
    }
}

/**
 * Draws a diagram with the official mermaid package, after any renders already queued, and resolves to its SVG
 * (see normaliseOfficialSvg). Each render has its own id, so two pictures on one page never share one. Rejects
 * with Mermaid's own message for text that doesn't parse, with RENDER_TIMEOUT_MESSAGE when it takes longer than
 * RENDER_TIMEOUT_MS, and with RendererLoadError when mermaid couldn't be loaded (the next render tries again).
 *
 * After a timeout, the next render waits for the stuck one to end inside Mermaid (up to STUCK_RENDER_WAIT_MS)
 * before it changes the settings and starts its own clock.
 */
export function renderOfficialDiagram(source: string, themeId: AppThemeId, { transparent = true }: OfficialRenderOptions = {}): Promise<string> {
    let finished: Promise<void> = Promise.resolve()
    const result = queueTail.then(() =>
        runRender(source, themeId, transparent, (drawn) => {
            finished = drawn
        })
    )
    queueTail = result.then(ignore, ignore).then(() => settledOrAfter(finished, STUCK_RENDER_WAIT_MS))
    return result
}
