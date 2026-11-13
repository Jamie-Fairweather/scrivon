import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { remarkGithubAlerts } from '@/lib/markdown/github-alerts'
import { remarkMath } from '@/lib/markdown/math'

/**
 * How Scrivon reads Markdown, everywhere: the preview, PDF and Word export, the export title and the diagram list.
 * GitHub's flavour, plus emphasis that works next to Chinese and Japanese punctuation: plain CommonMark doesn't
 * count 「」。、 as word boundaries, so `**「重要」**です` would stay as asterisks. One list, so they can't drift apart.
 * Math (`$…$` and `$$` blocks, with prices like `$5 and $10` kept as text) and GitHub's alerts (`> [!NOTE]`) too.
 * The alerts change the tree after it is read, so they only apply where the tree is run, not just parsed.
 */
export const markdownRemarkPlugins: PluggableList = [remarkGfm, remarkMath, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough, remarkGithubAlerts]
