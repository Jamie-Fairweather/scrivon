import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'

/**
 * Draws math as MathML, which the app's webview draws itself in the Windows math font, in the preview and the PDF.
 * It runs after the sanitizer: KaTeX's output is safe (links and HTML commands are off), and the sanitizer would
 * strip the MathML. A fenced ```` ```math ```` block is math too, as on GitHub. KaTeX is large, so the PDF export
 * loads this only for a document with math in it.
 */
export const mathRehypePlugins: PluggableList = [[rehypeKatex, { output: 'mathml' }]]
