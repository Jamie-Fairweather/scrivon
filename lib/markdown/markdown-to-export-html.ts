import { toHtml } from 'hast-util-to-html'
import type { Code, Parent, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { highlightFencedCode } from '@/lib/markdown/shiki-highlighter'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { getDiagramColors, SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'

const PDF_SHIKI_THEME = 'github-light' as const
const PDF_MERMAID_THEME = SYSTEM_LIGHT_THEME

function buildExportCss(mermaidBg: string): string {
    return `
  *, *::before, *::after { box-sizing: border-box; }
  html {
    color-scheme: light only;
  }
  html, body {
    margin: 0;
    background: #ffffff;
    color: #262626;
  }
  @page {
    size: A4;
    margin: 10mm;
  }
  @media print {
    html, body {
      background: #ffffff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-avoid-break,
    .code-block,
    .mermaid-export,
    table {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
  .export-article {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 1.5rem 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
  h3 { margin: 1.25rem 0 0.5rem; font-size: 1.125rem; font-weight: 600; }
  h4 { margin: 1rem 0 0.5rem; font-size: 1rem; font-weight: 600; }
  p { margin: 0 0 0.75rem; }
  ul, ol { margin: 0 0 0.75rem; padding-left: 1.25rem; }
  li { margin: 0.25rem 0; word-break: break-word; }
  blockquote {
    margin: 0 0 0.75rem;
    padding-left: 1rem;
    border-left: 2px solid #e5e5e5;
    color: #525252;
    font-style: italic;
  }
  hr { margin: 1.5rem 0; border: none; border-top: 1px solid #e5e5e5; }
  a { color: #262626; text-decoration: underline; }
  .export-article :not(pre) > code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.85em;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    background: #f5f5f5;
    border: 1px solid #ebebeb;
  }
  table {
    width: 100%;
    margin: 0 0 1rem;
    border-collapse: collapse;
    font-size: 14px;
  }
  thead { background: rgba(0, 0, 0, 0.04); }
  th, td {
    padding: 0.5rem 0.75rem;
    border: 1px solid #e5e5e5;
    text-align: left;
    vertical-align: top;
  }
  th { font-weight: 600; }
  .pdf-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .code-block {
    margin: 0 0 1rem;
  }
  .code-block pre.shiki {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    tab-size: 2;
  }
  .code-block pre.shiki code {
    display: block;
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
  }
  .code-block .line {
    display: block;
    min-height: 1.45em;
  }
  .mermaid-export {
    margin: 0 0 1rem;
    padding: 12px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    background: ${mermaidBg};
    overflow: hidden;
  }
  .mermaid-export svg {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .export-error {
    margin: 0 0 1rem;
    padding: 12px;
    border: 1px solid #fecaca;
    border-radius: 8px;
    background: #fef2f2;
    color: #991b1b;
    font-size: 12px;
    white-space: pre-wrap;
    font-family: ui-monospace, monospace;
  }
`
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function normalizeShikiPre(html: string): string {
    return html.replace(/\s*tabindex="0"/g, '')
}

async function codeBlockToHtml(node: Code): Promise<string> {
    const text = node.value.replace(/\n$/, '')
    const lang = node.lang?.toLowerCase()

    if (lang === 'mermaid') {
        try {
            const svg = renderMermaidDiagramForExport(text, PDF_MERMAID_THEME)
            return `<div class="mermaid-export pdf-avoid-break">${svg}</div>`
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return `<pre class="export-error pdf-avoid-break">${escapeHtml(message)}</pre>`
        }
    }

    try {
        const highlighted = normalizeShikiPre(await highlightFencedCode(text, lang, PDF_SHIKI_THEME))
        return `<div class="code-block pdf-avoid-break">${highlighted}</div>`
    } catch {
        return `<div class="code-block pdf-avoid-break"><pre><code>${escapeHtml(text)}</code></pre></div>`
    }
}

async function transformCodeBlocks(tree: Root): Promise<void> {
    const replacements: { parent: Parent; index: number; promise: Promise<string> }[] = []

    visit(tree, 'code', (node: Code, index, parent) => {
        if (index == null || !parent) return
        replacements.push({
            parent,
            index,
            promise: codeBlockToHtml(node),
        })
    })

    const htmlFragments = await Promise.all(replacements.map((r) => r.promise))
    replacements.forEach((r, i) => {
        r.parent.children[r.index] = { type: 'html', value: htmlFragments[i] }
    })
}

function exportStylesheet(): string {
    return buildExportCss(getDiagramColors(PDF_MERMAID_THEME).bg)
}

export async function markdownToExportHtml(source: string): Promise<string> {
    const trimmed = source.trim()
    if (!trimmed) {
        throw new Error('Nothing to export.')
    }

    const tree = unified().use(remarkParse).use(remarkGfm).parse(trimmed) as Root
    await transformCodeBlocks(tree)

    const hast = unified().use(remarkRehype, { allowDangerousHtml: true }).runSync(tree)
    const bodyHtml = toHtml(hast, { allowDangerousHtml: true })

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light only" />
  <style>${exportStylesheet()}</style>
</head>
<body>
  <article class="export-article">${bodyHtml}</article>
</body>
</html>`
}
