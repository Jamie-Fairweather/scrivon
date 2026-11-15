import type { PdfPreview } from '@/lib/markdown/export-pdf-preview'
import { errorMessage } from '@/lib/notify'

export type PdfPreviewState = {
    /** Object URL of the newest preview PDF; empty until there is one. */
    url: string
    /** What that PDF had to leave out (page numbers, images, the contents page); empty when nothing. */
    note: string
    /** A newer preview is waiting or being made. */
    updating: boolean
    /** Why the newest preview couldn't be made; empty when it could. */
    error: string
}

export type PdfPreviewStore = {
    getState: () => PdfPreviewState
    subscribe: (listener: () => void) => () => void
    /**
     * Makes a preview with `render` once no newer request has come for the delay. Only one
     * preview is made at a time; requests that come meanwhile wait, and only the newest runs.
     */
    request: (render: () => Promise<PdfPreview>) => void
    /** Drops the preview and frees its PDF. A preview still being made is thrown away. */
    clear: () => void
}

const EMPTY: PdfPreviewState = { url: '', note: '', updating: false, error: '' }

/** Keeps the export dialog's PDF preview: when to remake it, and the URL of the newest one. */
export function createPdfPreviewStore(delayMs: number): PdfPreviewStore {
    let state = EMPTY
    const listeners = new Set<() => void>()
    let timer: ReturnType<typeof setTimeout> | undefined
    /** The newest render whose delay is up, waiting for the one running to finish. */
    let next: (() => Promise<PdfPreview>) | undefined
    let running = false
    /** Goes up on clear(), so a render started before it is thrown away. */
    let generation = 0

    const update = (patch: Partial<PdfPreviewState> = {}) => {
        if (patch.url !== undefined && state.url && patch.url !== state.url) URL.revokeObjectURL(state.url)
        state = { ...state, ...patch, updating: timer !== undefined || next !== undefined || running }
        listeners.forEach((listener) => listener())
    }

    const run = async () => {
        if (running || !next) return
        const render = next
        next = undefined
        running = true
        const started = generation
        let shown: Partial<PdfPreviewState>
        try {
            const preview = await render()
            shown = started === generation ? { url: URL.createObjectURL(preview.pdf), note: preview.note ?? '', error: '' } : {}
        } catch (err) {
            shown = started === generation ? { url: '', note: '', error: errorMessage(err, "The preview couldn't be made.") } : {}
        }
        running = false
        update(shown)
        void run()
    }

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        request: (render) => {
            clearTimeout(timer)
            timer = setTimeout(() => {
                timer = undefined
                next = render
                void run()
                update()
            }, delayMs)
            update()
        },
        clear: () => {
            clearTimeout(timer)
            timer = undefined
            next = undefined
            generation++
            update({ url: '', note: '', error: '' })
        },
    }
}
