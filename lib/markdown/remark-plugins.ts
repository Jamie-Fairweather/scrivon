import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'

/**
 * How Scrivon reads Markdown, everywhere: the preview, PDF and Word export, the export title and the diagram list.
 * GitHub's flavour, plus emphasis that works next to Chinese and Japanese punctuation: plain CommonMark doesn't
 * count 「」。、 as word boundaries, so `**「重要」**です` would stay as asterisks. One list, so they can't drift apart.
 */
export const markdownRemarkPlugins: PluggableList = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough]
