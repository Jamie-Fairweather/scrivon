import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfPreview } from '@/lib/markdown/export-pdf-preview'
import { createPdfPreviewStore } from './pdf-preview-store'

const DELAY_MS = 500

/** A render that finishes when the test says so. */
function deferredRender() {
    let finish: (preview: PdfPreview) => void = () => undefined
    let fail: (err: unknown) => void = () => undefined
    const render = vi.fn(
        () =>
            new Promise<PdfPreview>((resolve, reject) => {
                finish = resolve
                fail = reject
            })
    )
    return { render, finish: (preview: PdfPreview) => finish(preview), fail: (err: unknown) => fail(err) }
}

function pdf(name: string): PdfPreview {
    return { pdf: new Blob([name], { type: 'application/pdf' }) }
}

describe('createPdfPreviewStore', () => {
    let urls: number
    // Names each URL by the PDF's size and the order it was made in.
    const createObjectURL = vi.fn((blob: Blob | MediaSource) => `blob:${(blob as Blob).size}-${++urls}`)
    const revokeObjectURL = vi.fn()

    beforeEach(() => {
        vi.useFakeTimers()
        urls = 0
        createObjectURL.mockClear()
        revokeObjectURL.mockClear()
        vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('makes one preview once the changes stop', async () => {
        const store = createPdfPreviewStore(DELAY_MS)
        const listener = vi.fn()
        store.subscribe(listener)
        const first = vi.fn(async () => pdf('first'))
        const last = vi.fn(async () => pdf('last'))

        store.request(first)
        await vi.advanceTimersByTimeAsync(DELAY_MS - 1)
        store.request(last)
        expect(store.getState()).toEqual({ url: '', note: '', updating: true, error: '' })
        expect(listener).toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(first).not.toHaveBeenCalled()
        expect(last).toHaveBeenCalledTimes(1)
        expect(store.getState()).toEqual({ url: 'blob:4-1', note: '', updating: false, error: '' })
    })

    it('makes one preview at a time, then the newest one asked for', async () => {
        const store = createPdfPreviewStore(DELAY_MS)
        const a = deferredRender()
        const b = deferredRender()
        const c = deferredRender()

        store.request(a.render)
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(a.render).toHaveBeenCalledTimes(1)

        store.request(b.render)
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        store.request(c.render)
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        // A is still printing, so nothing else starts.
        expect(b.render).not.toHaveBeenCalled()
        expect(c.render).not.toHaveBeenCalled()

        a.finish(pdf('a'))
        await vi.advanceTimersByTimeAsync(0)
        // A shows while C, the newest, prints. B was overtaken and never runs.
        expect(store.getState()).toMatchObject({ url: 'blob:1-1', updating: true })
        expect(b.render).not.toHaveBeenCalled()
        expect(c.render).toHaveBeenCalledTimes(1)

        c.finish({ ...pdf('ccc'), note: 'No room for page numbers.' })
        await vi.advanceTimersByTimeAsync(0)
        expect(store.getState()).toEqual({ url: 'blob:3-2', note: 'No room for page numbers.', updating: false, error: '' })
        // A's PDF is let go once C replaces it.
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:1-1')
    })

    it('says why a preview failed instead of showing an old one', async () => {
        const store = createPdfPreviewStore(DELAY_MS)
        store.request(async () => ({ ...pdf('ok'), note: 'No footer.' }))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(store.getState().url).toBe('blob:2-1')

        store.request(async () => {
            throw new Error('Nothing to export.')
        })
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(store.getState()).toEqual({ url: '', note: '', updating: false, error: 'Nothing to export.' })
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:2-1')

        // The command's own errors arrive as plain strings.
        store.request(() => Promise.reject('WebView2 on this system does not support PDF export.'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(store.getState().error).toBe('WebView2 on this system does not support PDF export.')

        store.request(async () => pdf('fixed'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(store.getState()).toMatchObject({ url: 'blob:5-2', error: '' })
    })

    it('clears the preview and ignores one still printing', async () => {
        const store = createPdfPreviewStore(DELAY_MS)
        store.request(async () => pdf('shown'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        const printing = deferredRender()
        store.request(printing.render)
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        const waiting = vi.fn(async () => pdf('waiting'))
        store.request(waiting)

        store.clear()
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:5-1')
        expect(store.getState()).toMatchObject({ url: '', note: '', error: '' })

        printing.finish(pdf('late'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(waiting).not.toHaveBeenCalled()
        expect(createObjectURL).toHaveBeenCalledTimes(1)
        expect(store.getState()).toEqual({ url: '', note: '', updating: false, error: '' })

        // A cleared store still makes previews when asked again.
        store.request(async () => pdf('again'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(store.getState().url).toBe('blob:5-2')
    })

    it('stops telling a listener once it unsubscribes', async () => {
        const store = createPdfPreviewStore(DELAY_MS)
        const listener = vi.fn()
        const unsubscribe = store.subscribe(listener)
        unsubscribe()
        store.request(async () => pdf('x'))
        await vi.advanceTimersByTimeAsync(DELAY_MS)
        expect(listener).not.toHaveBeenCalled()
    })
})
