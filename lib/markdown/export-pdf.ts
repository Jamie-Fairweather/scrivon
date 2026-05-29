import { invoke } from '@tauri-apps/api/core'
import { markdownToExportHtml } from '@/lib/markdown/markdown-to-export-html'
import { pickSavePath, showError } from '@/lib/tauri/dialog'
import { isWindowsTauri } from '@/lib/tauri/platform'

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]

export function markdownExportBaseName(tabName: string | undefined): string {
    if (!tabName) return 'document'
    const base = tabName.replace(/\.md$/i, '')
    return base || 'document'
}

function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
}

async function printExportHtml(html: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe')
        iframe.setAttribute('aria-hidden', 'true')
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:0;border:0;'

        const cleanup = () => {
            iframe.remove()
        }

        iframe.addEventListener(
            'load',
            () => {
                void (async () => {
                    try {
                        const doc = iframe.contentDocument
                        const win = iframe.contentWindow
                        const article = doc?.querySelector('.export-article')
                        if (!win || !doc?.body || !article?.innerHTML.trim()) {
                            throw new Error('Export document is empty.')
                        }

                        if (doc.fonts?.ready) {
                            await doc.fonts.ready
                        }
                        await waitForPaint()

                        const onAfterPrint = () => {
                            win.removeEventListener('afterprint', onAfterPrint)
                            cleanup()
                            resolve()
                        }

                        win.addEventListener('afterprint', onAfterPrint)
                        win.focus()
                        win.print()
                    } catch (err) {
                        cleanup()
                        reject(err)
                    }
                })()
            },
            { once: true }
        )

        iframe.srcdoc = html
        document.body.appendChild(iframe)
    })
}

async function savePdfWithWebView2(html: string, outputPath: string): Promise<void> {
    await invoke('export_html_to_pdf', { html, outputPath })
}

export async function exportMarkdownToPdf(source: string, tabName: string | undefined): Promise<void> {
    try {
        const html = await markdownToExportHtml(source)
        const filename = `${markdownExportBaseName(tabName)}.pdf`

        if (isWindowsTauri()) {
            const path = await pickSavePath({ title: 'Save PDF', defaultPath: filename, filters: PDF_FILTERS })
            if (!path) return
            await savePdfWithWebView2(html, path)
            return
        }

        await printExportHtml(html)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await showError('Export failed', message)
    }
}
