/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const pickSavePath = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())
const notifyWarning = vi.hoisted(() => vi.fn())
const revealItemInDir = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>(async () => undefined))
const writeBinaryFile = vi.hoisted(() => vi.fn())
const isWindowsTauri = vi.hoisted(() => vi.fn(() => false))
const isTauri = vi.hoisted(() => vi.fn(() => false))
const renderExportDocx = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])))
const EXPORT_DOCUMENT = vi.hoisted(() => ({
    html: '<html><body><article class="export-article">x</article></body></html>',
    metadata: { title: 'Hi', subtitle: '', author: '', date: '' },
    print: {
        pageWidthMm: 210,
        pageHeightMm: 297,
        landscape: false,
        marginTopMm: 10,
        marginRightMm: 10,
        marginBottomMm: 10,
        marginLeftMm: 10,
        pageNumberFormat: 'none',
        pageNumberColor: '',
    },
}))
const markdownToExportHtml = vi.hoisted(() => vi.fn(async () => EXPORT_DOCUMENT))
const EMPTY_ASSETS = vi.hoisted(() => ({ logoDataUrl: '', header: { left: '', right: '' }, footer: { left: '', right: '' } }))
const MISSING_LOGO = vi.hoisted(() => ({ slot: 'Logo', path: 'G:/brand/logo.png', reason: 'Could not read image: not found' }))
const resolvePdfExportAssets = vi.hoisted(() =>
    vi.fn<() => Promise<{ assets: typeof EMPTY_ASSETS; missing: (typeof MISSING_LOGO)[] }>>(async () => ({ assets: EMPTY_ASSETS, missing: [] }))
)

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/dialog', () => ({ pickSavePath, writeBinaryFile }))
vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError,
    notifySuccess,
    notifyWarning,
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }))
vi.mock('@/lib/tauri/platform', () => ({ isWindowsTauri, isTauri }))
vi.mock('@/lib/markdown/markdown-to-export-html', () => ({ markdownToExportHtml }))
vi.mock('@/lib/markdown/export-assets', () => ({ resolvePdfExportAssets }))
vi.mock('@/lib/markdown/export-docx', () => ({ renderExportDocx }))

describe('export-pdf helpers', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        invoke.mockReset()
        pickSavePath.mockReset()
        notifyError.mockReset()
        notifySuccess.mockReset()
        notifyWarning.mockReset()
        revealItemInDir.mockReset()
        revealItemInDir.mockResolvedValue(undefined)
        isWindowsTauri.mockReturnValue(false)
        isTauri.mockReset()
        isTauri.mockReturnValue(false)
        writeBinaryFile.mockReset()
        renderExportDocx.mockReset()
        renderExportDocx.mockResolvedValue(new Uint8Array([1, 2, 3]))
        markdownToExportHtml.mockReset()
        markdownToExportHtml.mockImplementation(async () => EXPORT_DOCUMENT)
        resolvePdfExportAssets.mockReset()
        resolvePdfExportAssets.mockResolvedValue({ assets: EMPTY_ASSETS, missing: [] })
        document.body.innerHTML = ''
    })

    it('derives export base names', async () => {
        const { markdownExportBaseName } = await import('@/lib/markdown/export-pdf')
        expect(markdownExportBaseName(undefined)).toBe('document')
        expect(markdownExportBaseName('notes.md')).toBe('notes')
        expect(markdownExportBaseName('.md')).toBe('document')
    })

    it('builds the document through the assets + markdown pipeline', async () => {
        const { buildMarkdownExportHtml } = await import('@/lib/markdown/export-pdf')
        const { createDefaultPdfExportProfile } = await import('@/lib/settings/pdf-export-defaults')
        const profile = createDefaultPdfExportProfile()
        const result = await buildMarkdownExportHtml('# Hi', 'hi.md', { profile, overrides: { title: 'Spec' } })
        expect(resolvePdfExportAssets).toHaveBeenCalledWith(profile)
        expect(markdownToExportHtml).toHaveBeenCalledWith('# Hi', {
            profile,
            tabName: 'hi.md',
            overrides: { title: 'Spec' },
            assets: EMPTY_ASSETS,
        })
        expect(result).toBe(EXPORT_DOCUMENT)
    })

    it('prints via iframe when not on windows tauri', async () => {
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')

        const print = vi.fn()
        const originalCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = originalCreate(tag)
            if (tag === 'iframe') {
                Object.defineProperty(el, 'contentDocument', {
                    get: () => ({
                        body: { innerHTML: 'x' },
                        querySelector: () => ({ innerHTML: 'content' }),
                    }),
                })
                Object.defineProperty(el, 'contentWindow', {
                    get: () => ({
                        focus: vi.fn(),
                        print,
                        addEventListener: (type: string, handler: () => void) => {
                            if (type === 'afterprint') handler()
                        },
                        removeEventListener: vi.fn(),
                    }),
                })
                queueMicrotask(() => el.dispatchEvent(new Event('load')))
            }
            return el
        })

        await expect(exportMarkdownToPdf('# Hi', 'hi.md')).resolves.toEqual({ status: 'saved' })
        expect(print).toHaveBeenCalled()
        expect(invoke).not.toHaveBeenCalled()
    })

    it('awaits document fonts when available before printing', async () => {
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        const print = vi.fn()
        const fontsReady = vi.fn(async () => undefined)
        const originalCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = originalCreate(tag)
            if (tag === 'iframe') {
                Object.defineProperty(el, 'contentDocument', {
                    get: () => ({
                        body: { innerHTML: 'x' },
                        fonts: { ready: fontsReady() },
                        querySelector: () => ({ innerHTML: 'content' }),
                    }),
                })
                Object.defineProperty(el, 'contentWindow', {
                    get: () => ({
                        focus: vi.fn(),
                        print,
                        addEventListener: (type: string, handler: () => void) => {
                            if (type === 'afterprint') handler()
                        },
                        removeEventListener: vi.fn(),
                    }),
                })
                queueMicrotask(() => el.dispatchEvent(new Event('load')))
            }
            return el
        })

        await exportMarkdownToPdf('# Hi', 'hi.md')
        expect(fontsReady).toHaveBeenCalled()
        expect(print).toHaveBeenCalled()
    })

    it('finishes and removes the print frame when afterprint never comes', async () => {
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        const print = vi.fn()
        let frame: HTMLElement | undefined
        const originalCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = originalCreate(tag)
            if (tag === 'iframe') {
                frame = el
                Object.defineProperty(el, 'contentDocument', {
                    get: () => ({ body: { innerHTML: 'x' }, querySelector: () => ({ innerHTML: 'content' }) }),
                })
                // A webview whose print() does nothing and never fires afterprint.
                Object.defineProperty(el, 'contentWindow', {
                    get: () => ({ focus: vi.fn(), print, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
                })
                queueMicrotask(() => el.dispatchEvent(new Event('load')))
            }
            return el
        })

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const result = exportMarkdownToPdf('# Hi', 'hi.md')
            await vi.waitFor(() => expect(print).toHaveBeenCalled())
            expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin allow-modals')
            expect(frame?.isConnected).toBe(true)
            await vi.advanceTimersByTimeAsync(1_500)
            await expect(result).resolves.toEqual({ status: 'saved' })
            expect(frame?.isConnected).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('reports empty print documents', async () => {
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        const originalCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = originalCreate(tag)
            if (tag === 'iframe') {
                Object.defineProperty(el, 'contentDocument', {
                    configurable: true,
                    get: () => ({
                        body: {},
                        querySelector: () => ({ innerHTML: '   ' }),
                    }),
                })
                Object.defineProperty(el, 'contentWindow', {
                    configurable: true,
                    get: () => ({
                        focus: vi.fn(),
                        print: vi.fn(),
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                    }),
                })
                queueMicrotask(() => el.dispatchEvent(new Event('load')))
            }
            return el
        })

        await expect(exportMarkdownToPdf('# Hi', 'hi.md')).resolves.toEqual({ status: 'failed', message: 'Export document is empty.' })
        expect(notifyError).toHaveBeenCalledWith('Export failed', undefined, { description: 'Export document is empty.' })
    })

    it('hands the html and its print options to webview2 on windows tauri', async () => {
        isWindowsTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.pdf')
        invoke.mockResolvedValue(undefined)
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdownToPdf('# Hi', 'hi.md')).resolves.toEqual({ status: 'saved', path: 'C:/out.pdf' })
        expect(invoke).toHaveBeenCalledWith('export_html_to_pdf', {
            html: EXPORT_DOCUMENT.html,
            outputPath: 'C:/out.pdf',
            options: EXPORT_DOCUMENT.print,
        })
    })

    it('cancels windows save when dialog is dismissed', async () => {
        isWindowsTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue(null)
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdownToPdf('# Hi', 'hi.md')).resolves.toEqual({ status: 'cancelled' })
        expect(invoke).not.toHaveBeenCalled()
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('returns pipeline errors to the caller without showing anything', async () => {
        markdownToExportHtml.mockRejectedValueOnce(new Error('boom'))
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'hi.md')).resolves.toEqual({ status: 'failed', message: 'boom' })
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('returns failures from the webview2 print', async () => {
        isWindowsTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.pdf')
        invoke.mockRejectedValueOnce('WebView2 on this system does not support PDF export.')
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'hi.md')).resolves.toEqual({
            status: 'failed',
            message: 'WebView2 on this system does not support PDF export.',
        })
    })

    it('tells the user about stringified non-error failures', async () => {
        markdownToExportHtml.mockRejectedValueOnce('nope')
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdownToPdf('# Hi', 'hi.md')).resolves.toEqual({ status: 'failed', message: 'nope' })
        expect(notifyError).toHaveBeenCalledWith('Export failed', undefined, { description: 'nope' })
    })

    it('writes a word document when the save dialog returns a path', async () => {
        isTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.docx')
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'notes.md', { format: 'docx' })).resolves.toEqual({ status: 'saved', path: 'C:/out.docx' })
        expect(pickSavePath).toHaveBeenCalledWith({
            title: 'Save Word document',
            defaultPath: 'notes.docx',
            filters: [{ name: 'Word document', extensions: ['docx'] }],
        })
        expect(writeBinaryFile).toHaveBeenCalledWith('C:/out.docx', new Uint8Array([1, 2, 3]))
        expect(renderExportDocx).toHaveBeenCalled()
    })

    it('does not write a word document when the save dialog is dismissed', async () => {
        isTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue(null)
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'notes.md', { format: 'docx' })).resolves.toEqual({ status: 'cancelled' })
        expect(writeBinaryFile).not.toHaveBeenCalled()
    })

    it('downloads a word document in the browser', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'notes.md', { format: 'docx' })).resolves.toEqual({ status: 'saved' })
        expect(writeBinaryFile).not.toHaveBeenCalled()
        expect(click).toHaveBeenCalled()
        click.mockRestore()
    })

    it('reports a word export that has nothing to write', async () => {
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('   ', 'notes.md', { format: 'docx' })).resolves.toEqual({ status: 'failed', message: 'Nothing to export.' })
        expect(renderExportDocx).not.toHaveBeenCalled()
    })

    it('says where the export was saved and can show it in its folder', async () => {
        const { notifyExportSaved } = await import('@/lib/markdown/export-pdf')
        const path = String.raw`C:\Users\ada\Reports\q3.pdf`
        notifyExportSaved(path)
        expect(notifySuccess).toHaveBeenCalledWith('Saved q3.pdf', expect.objectContaining({ description: path }))

        const options = notifySuccess.mock.calls[0]![1] as { action: { label: string; onClick: () => void } }
        expect(options.action.label).toBe('Show in folder')
        options.action.onClick()
        expect(revealItemInDir).toHaveBeenCalledWith(path)

        revealItemInDir.mockRejectedValueOnce(new Error('gone'))
        options.action.onClick()
        await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith('Could not show the file', expect.any(Error)))
    })

    it('reports profile images it had to leave out of a saved export', async () => {
        resolvePdfExportAssets.mockResolvedValue({ assets: EMPTY_ASSETS, missing: [MISSING_LOGO] })
        isWindowsTauri.mockReturnValue(true)
        isTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.pdf')
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await expect(exportMarkdown('# Hi', 'hi.md')).resolves.toEqual({ status: 'saved', path: 'C:/out.pdf', missingImages: [MISSING_LOGO] })
        // The images are read once and handed to the renderer.
        expect(resolvePdfExportAssets).toHaveBeenCalledTimes(1)
        expect(markdownToExportHtml).toHaveBeenCalledWith('# Hi', expect.objectContaining({ assets: EMPTY_ASSETS }))

        pickSavePath.mockResolvedValue('C:/out.docx')
        await expect(exportMarkdown('# Hi', 'hi.md', { format: 'docx' })).resolves.toMatchObject({ status: 'saved', missingImages: [MISSING_LOGO] })

        // Nothing was saved, so there is nothing to report.
        pickSavePath.mockResolvedValue(null)
        await expect(exportMarkdown('# Hi', 'hi.md')).resolves.toEqual({ status: 'cancelled' })
    })

    it('names the left-out images when the export is saved', async () => {
        const { notifyExportSaved } = await import('@/lib/markdown/export-pdf')
        notifyExportSaved('C:/out/q3.pdf', [MISSING_LOGO])
        expect(notifySuccess).not.toHaveBeenCalled()
        expect(notifyWarning).toHaveBeenCalledWith('Saved q3.pdf without some images', {
            description: 'Logo (logo.png): Could not read image: not found',
            action: expect.objectContaining({ label: 'Show in folder' }),
        })

        // Printed or downloaded: no path to show, but the user still hears about the images.
        notifyWarning.mockReset()
        notifyExportSaved(undefined, [MISSING_LOGO])
        expect(notifyWarning).toHaveBeenCalledWith('Some images were left out', { description: 'Logo (logo.png): Could not read image: not found' })
        notifyWarning.mockReset()
        notifyExportSaved(undefined)
        expect(notifyWarning).not.toHaveBeenCalled()
        expect(notifySuccess).not.toHaveBeenCalled()
    })
})
