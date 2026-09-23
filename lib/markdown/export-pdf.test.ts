/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const pickSavePath = vi.hoisted(() => vi.fn())
const showError = vi.hoisted(() => vi.fn())
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
const resolvePdfExportAssets = vi.hoisted(() => vi.fn(async () => EMPTY_ASSETS))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/dialog', () => ({ pickSavePath, showError, writeBinaryFile }))
vi.mock('@/lib/tauri/platform', () => ({ isWindowsTauri, isTauri }))
vi.mock('@/lib/markdown/markdown-to-export-html', () => ({ markdownToExportHtml }))
vi.mock('@/lib/markdown/export-assets', () => ({ resolvePdfExportAssets }))
vi.mock('@/lib/markdown/export-docx', () => ({ renderExportDocx }))

describe('export-pdf helpers', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        invoke.mockReset()
        pickSavePath.mockReset()
        showError.mockReset()
        isWindowsTauri.mockReturnValue(false)
        isTauri.mockReset()
        isTauri.mockReturnValue(false)
        writeBinaryFile.mockReset()
        renderExportDocx.mockReset()
        renderExportDocx.mockResolvedValue(new Uint8Array([1, 2, 3]))
        markdownToExportHtml.mockReset()
        markdownToExportHtml.mockImplementation(async () => EXPORT_DOCUMENT)
        resolvePdfExportAssets.mockReset()
        resolvePdfExportAssets.mockResolvedValue(EMPTY_ASSETS)
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

        await exportMarkdownToPdf('# Hi', 'hi.md')
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

        await exportMarkdownToPdf('# Hi', 'hi.md')
        expect(showError).toHaveBeenCalledWith('Export failed', 'Export document is empty.')
    })

    it('hands the html and its print options to webview2 on windows tauri', async () => {
        isWindowsTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.pdf')
        invoke.mockResolvedValue(undefined)
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await exportMarkdownToPdf('# Hi', 'hi.md')
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
        await exportMarkdownToPdf('# Hi', 'hi.md')
        expect(invoke).not.toHaveBeenCalled()
    })

    it('shows errors from the export pipeline', async () => {
        markdownToExportHtml.mockRejectedValueOnce(new Error('boom'))
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await exportMarkdownToPdf('# Hi', 'hi.md')
        expect(showError).toHaveBeenCalledWith('Export failed', 'boom')
    })

    it('shows stringified non-error failures', async () => {
        markdownToExportHtml.mockRejectedValueOnce('nope')
        const { exportMarkdownToPdf } = await import('@/lib/markdown/export-pdf')
        await exportMarkdownToPdf('# Hi', 'hi.md')
        expect(showError).toHaveBeenCalledWith('Export failed', 'nope')
    })

    it('writes a word document when the save dialog returns a path', async () => {
        isTauri.mockReturnValue(true)
        pickSavePath.mockResolvedValue('C:/out.docx')
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await exportMarkdown('# Hi', 'notes.md', { format: 'docx' })
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
        await exportMarkdown('# Hi', 'notes.md', { format: 'docx' })
        expect(writeBinaryFile).not.toHaveBeenCalled()
    })

    it('downloads a word document in the browser', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await exportMarkdown('# Hi', 'notes.md', { format: 'docx' })
        expect(writeBinaryFile).not.toHaveBeenCalled()
        expect(click).toHaveBeenCalled()
        click.mockRestore()
    })

    it('reports a word export that has nothing to write', async () => {
        const { exportMarkdown } = await import('@/lib/markdown/export-pdf')
        await exportMarkdown('   ', 'notes.md', { format: 'docx' })
        expect(showError).toHaveBeenCalledWith('Export failed', 'Nothing to export.')
        expect(renderExportDocx).not.toHaveBeenCalled()
    })
})
